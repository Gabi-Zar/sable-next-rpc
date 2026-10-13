//! Bounded, UI-independent notification decryption for the iOS service extension.

use std::ffi::{CStr, CString, c_char};
use std::path::Path;

use sable_core::session::AccountRegistry;
use sable_core::store::{FileSessionStore, SessionStore};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

#[derive(Default, Deserialize)]
#[serde(default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "persisted notification preferences"
)]
struct Policy {
    enabled: bool,
    content: bool,
    encrypted_content: bool,
    sounds: bool,
    notify_once: bool,
}

fn policy(root: &Path) -> Policy {
    std::fs::read(root.join("push-policy.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// # Safety
/// `root` must be null or a valid NUL-terminated UTF-8 path for this call.
#[expect(
    unsafe_code,
    reason = "C ABI used by the notification service extension"
)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sable_push_sounds(root: *const c_char) -> bool {
    if root.is_null() {
        return false;
    }
    std::panic::catch_unwind(|| {
        // SAFETY: the caller guarantees a valid C string for this call.
        let Ok(root) = (unsafe { CStr::from_ptr(root) }).to_str() else {
            return false;
        };
        let settings = policy(Path::new(root));
        settings.enabled && settings.sounds
    })
    .unwrap_or(false)
}

/// # Safety
/// `root` must be null or a valid NUL-terminated UTF-8 path for this call.
#[expect(
    unsafe_code,
    reason = "C ABI used by the notification service extension"
)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sable_push_notify_once(root: *const c_char) -> bool {
    if root.is_null() {
        return false;
    }
    std::panic::catch_unwind(|| {
        // SAFETY: the caller guarantees a valid C string for this call.
        let Ok(root) = (unsafe { CStr::from_ptr(root) }).to_str() else {
            return false;
        };
        policy(Path::new(root)).notify_once
    })
    .unwrap_or(false)
}

fn notification(payload: &Value) -> &Value {
    payload.get("notification").unwrap_or(payload)
}

const RING_TYPES: [&str; 2] = ["m.rtc.notification", "org.matrix.msc4075.rtc.notification"];
const DEFAULT_RING_LIFETIME_MS: u64 = 30_000;

#[derive(Serialize)]
struct RingOut<'a> {
    caller_name: &'a str,
    expires_at: f64,
}

#[derive(Serialize)]
struct RingPushOut<'a> {
    ring: Value,
    room_id: &'a str,
    user_id: &'a str,
}

#[derive(Serialize)]
struct ContentPushOut<'a> {
    body: &'a str,
    room_id: &'a str,
    user_id: &'a str,
    sounds: bool,
    noisy: bool,
}

/// A field that is absent, or `None` when it is the wrong type.
fn lenient<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(serde_json::from_value(Value::deserialize(deserializer)?).ok())
}

/// A field kept as received when present, `null` included.
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
struct RingEvent {
    #[serde(rename = "type")]
    kind: String,
    content: RingContent,
    #[serde(default, deserialize_with = "lenient")]
    origin_server_ts: Option<u64>,
    #[serde(default, deserialize_with = "present")]
    sender: Option<Value>,
}

#[derive(Deserialize)]
struct RingContent {
    notification_type: String,
    #[serde(default, deserialize_with = "lenient")]
    sender_ts: Option<u64>,
    #[serde(default, deserialize_with = "lenient")]
    lifetime: Option<u64>,
}

#[derive(Default, Deserialize)]
struct Named {
    #[serde(default, deserialize_with = "present")]
    sender_display_name: Option<Value>,
}

fn ring(event: &Value, notification: &Value) -> Option<Value> {
    let event = RingEvent::deserialize(event).ok()?;
    if !RING_TYPES.contains(&event.kind.as_str()) || event.content.notification_type != "ring" {
        return None;
    }
    let sent = event.content.sender_ts.or(event.origin_server_ts)?;
    let lifetime = event.content.lifetime.unwrap_or(DEFAULT_RING_LIFETIME_MS);
    let caller = Named::deserialize(notification)
        .unwrap_or_default()
        .sender_display_name
        .or(event.sender)
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    #[expect(
        clippy::cast_precision_loss,
        reason = "milliseconds since 1970 fit an f64 exactly for millennia"
    )]
    let expires_at = sent.saturating_add(lifetime) as f64 / 1000.0;
    serde_json::to_value(RingOut {
        caller_name: &caller,
        expires_at,
    })
    .ok()
}

#[derive(Default, Deserialize)]
struct Device {
    #[serde(default, deserialize_with = "lenient")]
    tweaks: Option<Map<String, Value>>,
}

#[derive(Default, Deserialize)]
struct Devices {
    #[serde(default, deserialize_with = "lenient_devices")]
    devices: Vec<Device>,
}

fn lenient_devices<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Device>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(devices) => devices
            .into_iter()
            .filter_map(|device| serde_json::from_value(device).ok())
            .collect(),
        _ => Vec::new(),
    })
}

fn rings(notification: &Value) -> bool {
    Devices::deserialize(notification)
        .unwrap_or_default()
        .devices
        .iter()
        .filter_map(|device| device.tweaks.as_ref())
        .any(|tweaks| {
            tweaks.contains_key("sound") || tweaks.get("highlight") == Some(&Value::Bool(true))
        })
}

#[derive(Deserialize)]
struct PushTarget<'a> {
    #[serde(default, deserialize_with = "present")]
    user_id: Option<Value>,
    room_id: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
}

#[derive(Default, Deserialize)]
struct PayloadUser {
    #[serde(default, deserialize_with = "present")]
    user_id: Option<Value>,
}

#[derive(Deserialize)]
struct ClearEvent<'a> {
    #[serde(borrow)]
    content: ClearContent<'a>,
}

#[derive(Deserialize)]
struct ClearContent<'a> {
    body: &'a str,
}

async fn render(root: &Path, payload: &Value) -> Option<Value> {
    let settings = policy(root);
    if !settings.enabled {
        return None;
    }
    let notification = notification(payload);
    let target = PushTarget::deserialize(notification).ok()?;
    let user = target
        .user_id
        .or_else(|| {
            PayloadUser::deserialize(payload)
                .unwrap_or_default()
                .user_id
        })
        .as_ref()?
        .as_str()?
        .to_owned();
    let user = user.as_str();
    let room_id = target.room_id;
    let bytes = FileSessionStore::new(root).load().await.ok()??;
    let (registry, _) = AccountRegistry::from_bytes(&bytes, root.to_str()?).ok()?;
    // Never select an arbitrary saved account for a push, including after logout.
    let account = registry.accounts.iter().find(|account| {
        !account.needs_reauth
            && registry.active_account_id.as_deref() == Some(account.account_id.as_str())
            && account.session.credentials.user_id() == user
    })?;
    let encrypted = target.kind == "m.room.encrypted";
    let event = if encrypted {
        let mut event = notification.clone();
        event
            .as_object_mut()?
            .entry("origin_server_ts")
            .or_insert(Value::from(0));
        let clear = sable_core::notifications::decrypt_push_from_store(
            root,
            user,
            &account.session.credentials.device_id(),
            room_id,
            &event.to_string(),
        )
        .await?;
        serde_json::from_str::<Value>(&clear).ok()?
    } else {
        notification.clone()
    };
    if let Some(ring) = ring(&event, notification) {
        return serde_json::to_value(RingPushOut {
            ring,
            room_id,
            user_id: user,
        })
        .ok();
    }
    if !settings.content || (encrypted && !settings.encrypted_content) {
        return None;
    }
    let body = ClearEvent::deserialize(&event).ok()?.content.body;
    // Recheck policy after decryption, which may overlap a settings change.
    let current = policy(root);
    if !current.enabled || !current.content || (encrypted && !current.encrypted_content) {
        return None;
    }
    let latest = FileSessionStore::new(root).load().await.ok()??;
    let (latest, _) = AccountRegistry::from_bytes(&latest, root.to_str()?).ok()?;
    if !latest.accounts.iter().any(|saved| {
        saved.account_id == account.account_id
            && !saved.needs_reauth
            && latest.active_account_id.as_deref() == Some(saved.account_id.as_str())
            && saved.session.credentials.user_id() == user
            && saved.session.credentials.device_id() == account.session.credentials.device_id()
    }) {
        return None;
    }
    let noisy = event
        .get(sable_core::notifications::NOISY_KEY)
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || rings(notification);
    serde_json::to_value(ContentPushOut {
        body,
        room_id,
        user_id: user,
        sounds: current.sounds,
        noisy,
    })
    .ok()
}

/// # Safety
/// Both arguments must be valid NUL-terminated UTF-8 strings for this call.
/// The returned string must be released with `sable_push_free` exactly once.
#[expect(
    unsafe_code,
    reason = "C ABI used by the notification service extension"
)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sable_push_render(
    root: *const c_char,
    payload: *const c_char,
) -> *mut c_char {
    if root.is_null() || payload.is_null() {
        return std::ptr::null_mut();
    }
    let rendered = std::panic::catch_unwind(|| {
        // SAFETY: the caller guarantees valid C strings for the duration of this call.
        let root = unsafe { CStr::from_ptr(root) }.to_str().ok()?;
        // SAFETY: same contract as root above.
        let payload = unsafe { CStr::from_ptr(payload) }.to_str().ok()?;
        let payload = serde_json::from_str(payload).ok()?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .ok()?;
        let rendered = runtime.block_on(async {
            tokio::time::timeout(
                std::time::Duration::from_secs(20),
                render(Path::new(root), &payload),
            )
            .await
            .ok()
            .flatten()
        })?;
        CString::new(rendered.to_string())
            .ok()
            .map(CString::into_raw)
    });
    rendered.ok().flatten().unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `value` must be null or an unreleased pointer returned by `sable_push_render`.
#[expect(unsafe_code, reason = "releases a string allocated by the C ABI")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sable_push_free(value: *mut c_char) {
    if !value.is_null() {
        // SAFETY: ownership is returned by the caller under the documented contract.
        drop(unsafe { CString::from_raw(value) });
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    #[expect(unsafe_code, reason = "tests the extension C ABI with owned C strings")]
    fn sound_policy_is_independent_of_preview_and_decryption() {
        let root = std::env::temp_dir().join(format!("sable-sound-policy-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = CString::new(root.to_str().unwrap()).unwrap();
        for (enabled, content, sounds, expected) in [
            (true, false, true, true),
            (true, true, true, true),
            (true, true, false, false),
            (false, true, true, false),
        ] {
            std::fs::write(root.join("push-policy.json"), json!({"enabled":enabled,"content":content,"encrypted_content":false,"sounds":sounds,"notify_once":false}).to_string()).unwrap();
            // SAFETY: path remains alive throughout the call.
            assert_eq!(unsafe { sable_push_sounds(path.as_ptr()) }, expected);
        }
        // SAFETY: null is explicitly accepted by this ABI.
        assert!(!unsafe { sable_push_sounds(std::ptr::null()) });
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[expect(unsafe_code, reason = "tests the extension C ABI with owned C strings")]
    fn notify_once_is_read_back_from_the_stored_policy() {
        let root = std::env::temp_dir().join(format!("sable-notify-once-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = CString::new(root.to_str().unwrap()).unwrap();
        for notify_once in [true, false] {
            std::fs::write(root.join("push-policy.json"), json!({"enabled":true,"content":true,"encrypted_content":false,"sounds":true,"notify_once":notify_once}).to_string()).unwrap();
            assert_eq!(
                // SAFETY: path remains alive throughout the call.
                unsafe { sable_push_notify_once(path.as_ptr()) },
                notify_once
            );
        }
        // SAFETY: null is explicitly accepted by this ABI.
        assert!(!unsafe { sable_push_notify_once(std::ptr::null()) });
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn missing_policy_and_session_fail_closed() {
        assert!(
            render(
                Path::new("/nonexistent-sable-push-test"),
                &json!({"content":{"body":"private"}})
            )
            .await
            .is_none()
        );
    }

    #[test]
    fn only_a_ring_notification_is_a_ring() {
        let event = |kind: &str, notification_type: &str| {
            json!({"type":kind,"sender":"@bob:example.org","origin_server_ts":2_000,
                "content":{"notification_type":notification_type}})
        };
        let named = json!({"sender_display_name":"Bob"});

        assert_eq!(
            ring(
                &event("org.matrix.msc4075.rtc.notification", "ring"),
                &named
            ),
            Some(json!({"caller_name":"Bob","expires_at":32.0}))
        );
        assert!(ring(&event("m.rtc.notification", "notification"), &named).is_none());
        assert!(ring(&event("m.room.message", "ring"), &named).is_none());
    }

    #[test]
    fn a_push_rings_when_its_rule_set_a_sound_or_a_highlight() {
        let push = |tweaks: Value| json!({"devices":[{"pushkey":"k","tweaks":tweaks}]});

        assert!(rings(&push(json!({"sound":"default"}))));
        assert!(rings(&push(json!({"highlight":true}))));
        assert!(!rings(&push(json!({"highlight":false}))));
        assert!(!rings(&json!({"room_id":"!room:example.org"})));
    }

    #[test]
    fn accepts_both_matrix_payload_envelopes() {
        let inner = json!({"room_id":"!room:example.org"});
        assert_eq!(notification(&inner), &inner);
        assert_eq!(notification(&json!({"notification":inner.clone()})), &inner);
    }

    #[tokio::test]
    async fn previews_require_policy_and_the_current_authenticated_account() {
        let root =
            std::env::temp_dir().join(format!("sable-push-policy-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("push-policy.json"),
            r#"{"enabled":true,"content":true,"encrypted_content":false,"sounds":true}"#,
        )
        .unwrap();
        let registry = json!({"version":1,"active_account_id":"a1","next_account_id":2,"accounts":[{
            "account_id":"a1","store_id":"old","needs_reauth":false,
            "session":{"homeserver":"https://example.org","credentials":{
                "kind":"password","user_id":"@alice:example.org","device_id":"A","access_token":"test"
            }}
        }]});
        let store = FileSessionStore::new(&root);
        store.save(registry.to_string().into_bytes()).await.unwrap();
        let mut payload = json!({"user_id":"@alice:example.org","notification":{
            "room_id":"!room:example.org","type":"m.room.message","content":{"body":"private"}
        }});
        assert_eq!(
            render(&root, &payload)
                .await
                .and_then(|value| value.get("body").cloned()),
            Some(json!("private"))
        );
        payload["user_id"] = json!("@other:example.org");
        assert!(render(&root, &payload).await.is_none());
        payload["user_id"] = json!("@alice:example.org");
        payload["notification"]["type"] = json!("m.room.encrypted");
        assert!(render(&root, &payload).await.is_none());
        payload["notification"]["type"] = json!("m.room.message");
        let mut expired = registry.clone();
        expired["accounts"][0]["needs_reauth"] = json!(true);
        store.save(expired.to_string().into_bytes()).await.unwrap();
        assert!(render(&root, &payload).await.is_none());
        store.save(registry.to_string().into_bytes()).await.unwrap();
        std::fs::write(
            root.join("push-policy.json"),
            r#"{"enabled":true,"content":false}"#,
        )
        .unwrap();
        assert!(render(&root, &payload).await.is_none());
        let ringing = json!({"user_id":"@alice:example.org","notification":{
            "room_id":"!room:example.org","type":"m.rtc.notification","sender":"@bob:example.org",
            "content":{"notification_type":"ring","sender_ts":1_000,"lifetime":30_000}
        }});
        assert_eq!(
            render(&root, &ringing)
                .await
                .and_then(|value| value.get("ring").cloned()),
            Some(json!({"caller_name":"@bob:example.org","expires_at":31.0}))
        );
        store.clear().await.unwrap();
        assert!(render(&root, &payload).await.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_ring_with_wrong_typed_parts_falls_back_or_is_not_a_ring() {
        let ring_of = |content: Value, extra: Value| {
            let mut event = json!({"type": "m.rtc.notification", "sender": "@bob:x", "origin_server_ts": 1_000, "content": content});
            event
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            ring(&event, &json!({}))
        };
        let wrong = ring_of(
            json!({"notification_type": "ring", "sender_ts": "late", "lifetime": -1}),
            json!({}),
        );
        assert_eq!(
            wrong,
            Some(json!({"caller_name": "@bob:x", "expires_at": 31.0}))
        );
        assert_eq!(ring_of(json!({"notification_type": 1}), json!({})), None);
        assert_eq!(ring_of(json!("ring"), json!({})), None);
        assert_eq!(
            ring_of(
                json!({"notification_type": "ring"}),
                json!({"origin_server_ts": "x"})
            ),
            None
        );
        let named = ring(
            &json!({"type": "m.rtc.notification", "sender": "@bob:x", "origin_server_ts": 1_000, "content": {"notification_type": "ring"}}),
            &json!({"sender_display_name": null}),
        );
        assert_eq!(named, Some(json!({"caller_name": "", "expires_at": 31.0})));
    }

    #[test]
    fn devices_that_are_not_objects_do_not_make_a_push_ring() {
        assert!(!rings(
            &json!({"devices": ["junk", {"tweaks": 3}, {"tweaks": {"highlight": 1}}]})
        ));
        assert!(rings(
            &json!({"devices": ["junk", {"tweaks": {"sound": null}}]})
        ));
        assert!(!rings(&json!({"devices": {"tweaks": {"sound": "x"}}})));
    }
}
