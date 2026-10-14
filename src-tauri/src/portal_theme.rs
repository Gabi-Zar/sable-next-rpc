use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::Duration;

use tauri::{AppHandle, Runtime, Theme};
use zbus::zvariant::OwnedValue;

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";

// A desktop theme switch emits several `SettingChanged` signals in a row.
const SETTLE: Duration = Duration::from_millis(250);

/// `None` ignores the value. `Some(None)` is the portal's "no preference".
fn theme_for(raw: u32) -> Option<Option<Theme>> {
    match raw {
        0 => Some(None),
        1 => Some(Some(Theme::Dark)),
        2 => Some(Some(Theme::Light)),
        _ => None,
    }
}

fn parse(value: OwnedValue) -> Option<Option<Theme>> {
    theme_for(u32::try_from(value).ok()?)
}

/// Blocks for the first update, then keeps the last one until the channel has
/// been quiet for `window`. `None` once every sender is gone.
fn settle<T>(rx: &Receiver<T>, window: Duration) -> Option<T> {
    let mut latest = rx.recv().ok()?;
    loop {
        match rx.recv_timeout(window) {
            Ok(next) => latest = next,
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => return Some(latest),
        }
    }
}

/// Remembers the last applied value so repeats never reach the runtime.
struct Applied(Option<Option<Theme>>);

impl Applied {
    fn changed(&mut self, next: Option<Theme>) -> bool {
        if self.0 == Some(next) {
            return false;
        }
        self.0 = Some(next);
        true
    }
}

pub fn follow<R: Runtime>(app: AppHandle<R>) {
    let (tx, rx) = channel();

    std::thread::spawn(move || {
        let mut applied = Applied(None);
        while let Some(theme) = settle(&rx, SETTLE) {
            if applied.changed(theme) {
                app.set_theme(theme);
            }
        }
    });

    std::thread::spawn(move || {
        let Ok(connection) = zbus::blocking::Connection::session() else {
            return;
        };
        let Ok(proxy) = zbus::blocking::Proxy::new(
            &connection,
            "org.freedesktop.portal.Desktop",
            "/org/freedesktop/portal/desktop",
            "org.freedesktop.portal.Settings",
        ) else {
            return;
        };
        let Ok(changes) = proxy.receive_signal("SettingChanged") else {
            return;
        };
        if let Some(theme) = proxy
            .call::<_, _, OwnedValue>("ReadOne", &(NAMESPACE, KEY))
            .ok()
            .and_then(parse)
        {
            let _ = tx.send(theme);
        }
        for message in changes {
            let Ok((namespace, key, value)) =
                message.body().deserialize::<(String, String, OwnedValue)>()
            else {
                continue;
            };
            if namespace != NAMESPACE || key != KEY {
                continue;
            }
            if let Some(theme) = parse(value) {
                let _ = tx.send(theme);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_values_and_ignores_the_rest() {
        assert_eq!(theme_for(0), Some(None));
        assert_eq!(theme_for(1), Some(Some(Theme::Dark)));
        assert_eq!(theme_for(2), Some(Some(Theme::Light)));
        assert_eq!(theme_for(3), None);
        assert_eq!(theme_for(u32::MAX), None);
    }

    #[test]
    fn applied_skips_repeats_but_not_changes() {
        let mut applied = Applied(None);
        assert!(applied.changed(Some(Theme::Dark)));
        assert!(!applied.changed(Some(Theme::Dark)));
        assert!(applied.changed(None));
        assert!(!applied.changed(None));
        assert!(applied.changed(Some(Theme::Light)));
    }

    #[test]
    fn settle_keeps_only_the_last_of_a_burst() {
        let (tx, rx) = channel();
        for n in [1, 2, 3] {
            tx.send(n).unwrap();
        }
        assert_eq!(settle(&rx, Duration::from_millis(20)), Some(3));
    }

    #[test]
    fn settle_ends_when_senders_are_gone() {
        let (tx, rx) = channel::<u8>();
        drop(tx);
        assert_eq!(settle(&rx, Duration::from_millis(20)), None);
    }
}
