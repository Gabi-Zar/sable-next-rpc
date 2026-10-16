use std::sync::Arc;
use std::time::Duration;

use matrix_sdk::Client;
use matrix_sdk::executor::spawn;
use matrix_sdk_ui::unable_to_decrypt_hook::{
    UnableToDecryptHook, UnableToDecryptInfo, UtdHookManager,
};

const GRACE_PERIOD: Duration = Duration::from_secs(10);

#[derive(Debug)]
struct UtdReporter {
    client: Client,
}

impl UnableToDecryptHook for UtdReporter {
    fn on_utd(&self, info: UnableToDecryptInfo) {
        if info.time_to_decrypt.is_none() {
            drop(spawn(report(self.client.clone(), info)));
        }
    }
}

async fn report(client: Client, info: UnableToDecryptInfo) {
    let encryption = client.encryption();
    let device_cross_signed = encryption
        .get_own_device()
        .await
        .ok()
        .flatten()
        .map(|device| device.is_cross_signed_by_owner());
    let account_cross_signed = encryption
        .cross_signing_status()
        .await
        .is_some_and(|status| status.is_complete());
    tracing::warn!(
        cause = ?info.cause,
        age = event_age(info.event_local_age_millis),
        own_identity_trusted = info.user_trusts_own_identity,
        same_homeserver = info.own_homeserver.as_ref() == Some(&info.sender_homeserver),
        backup = ?encryption.backups().state(),
        account_cross_signed,
        device_cross_signed,
        "unable to decrypt a message"
    );
}

const fn event_age(millis_since_device_created: i64) -> &'static str {
    const HOUR: i64 = 3_600_000;
    const DAY: i64 = 24 * HOUR;
    match millis_since_device_created {
        ..0 => "before_this_device",
        0..HOUR => "first_hour",
        HOUR..DAY => "first_day",
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
        UtdHookManager::new(
            Arc::new(UtdReporter {
                client: client.clone(),
            }),
            client.clone(),
        )
        .with_max_delay(GRACE_PERIOD),
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
