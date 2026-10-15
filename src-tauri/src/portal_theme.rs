use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Runtime, Theme};
use zbus::zvariant::OwnedValue;

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";
const EVENT: &str = "sable://color-scheme";

static CURRENT: Mutex<Option<Theme>> = Mutex::new(None);

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

fn scheme_name(theme: Option<Theme>) -> Option<&'static str> {
    match theme? {
        Theme::Dark => Some("dark"),
        Theme::Light => Some("light"),
        _ => None,
    }
}

pub fn current_scheme() -> Option<&'static str> {
    scheme_name(*CURRENT.lock().unwrap_or_else(PoisonError::into_inner))
}

fn apply<R: Runtime>(app: &AppHandle<R>, theme: Option<Theme>) {
    *CURRENT.lock().unwrap_or_else(PoisonError::into_inner) = theme;
    app.set_theme(theme);
    if let Err(error) = app.emit(EVENT, scheme_name(theme)) {
        log::warn!("could not send the portal colour scheme to the webview: {error}");
    }
}

pub fn follow<R: Runtime>(app: AppHandle<R>) {
    let (tx, rx) = channel();

    std::thread::spawn(move || {
        let mut applied = Applied(None);
        let mut next = rx.recv().ok();
        while let Some(theme) = next {
            if applied.changed(theme) {
                apply(&app, theme);
            }
            next = settle(&rx, SETTLE);
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
    fn names_only_an_explicit_scheme() {
        assert_eq!(scheme_name(Some(Theme::Dark)), Some("dark"));
        assert_eq!(scheme_name(Some(Theme::Light)), Some("light"));
        assert_eq!(scheme_name(None), None);
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
