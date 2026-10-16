use std::sync::Arc;
use std::time::Duration;

use matrix_sdk::Client;
use matrix_sdk_ui::unable_to_decrypt_hook::{
    UnableToDecryptHook, UnableToDecryptInfo, UtdHookManager,
};

const GRACE_PERIOD: Duration = Duration::from_secs(10);

#[derive(Debug)]
struct UtdReporter;

impl UnableToDecryptHook for UtdReporter {
    fn on_utd(&self, info: UnableToDecryptInfo) {
        let same_homeserver = info.own_homeserver.as_ref() == Some(&info.sender_homeserver);
        let age = event_age(info.event_local_age_millis);
        match info.time_to_decrypt {
            None => tracing::warn!(
                cause = ?info.cause,
                age,
                own_identity_trusted = info.user_trusts_own_identity,
                same_homeserver,
                "unable to decrypt a message"
            ),
            Some(waited) => tracing::debug!(
                cause = ?info.cause,
                age,
                waited_ms = u64::try_from(waited.as_millis()).unwrap_or(u64::MAX),
                "decrypted a message late"
            ),
        }
    }
}

const fn event_age(millis_since_device_created: i64) -> &'static str {
    const HOUR: i64 = 3_600_000;
    match millis_since_device_created {
        ..0 => "before_this_device",
        0..HOUR => "first_hour",
        HOUR..86_400_000 => "first_day",
        _ => "later",
    }
}

#[cfg_attr(
    target_family = "wasm",
    expect(
        clippy::arc_with_non_send_sync,
        reason = "the WASM core is single-threaded"
    )
)]
pub(crate) fn hook(client: &Client) -> Arc<UtdHookManager> {
    Arc::new(
        UtdHookManager::new(Arc::new(UtdReporter), client.clone()).with_max_delay(GRACE_PERIOD),
    )
}

#[cfg(test)]
mod tests {
    use super::event_age;

    #[test]
    fn an_event_age_falls_into_one_coarse_bucket() {
        assert_eq!(event_age(-1), "before_this_device");
        assert_eq!(event_age(0), "first_hour");
        assert_eq!(event_age(3_600_000), "first_day");
        assert_eq!(event_age(86_400_000), "later");
    }
}
