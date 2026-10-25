//! Bounded, UI-independent notification decryption for the iOS service extension.

use std::ffi::{CStr, CString, c_char};
use std::path::Path;

use sable_core::notifications::{ColdPush, PushImage, PushMedia, PushSession, push_sender_name};
use sable_core::protocol::{PushEventView, PushFetchView};
use sable_core::session::AccountRegistry;
use sable_core::store::{FileSessionStore, SessionStore};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use serde_with::{DefaultOnError, VecSkipError, serde_as};

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
    clear_on_read: bool,
    quiet_when_active_elsewhere: bool,
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

/// Sygnal's APNs payload names only the event; the fetched event fills in the rest.
fn complete(notification: &Value, event: &PushEventView) -> Option<Value> {
    let mut completed = notification.as_object()?.clone();
    let Value::Object(fetched) = serde_json::to_value(event).ok()? else {
        return None;
    };
    completed.extend(fetched.into_iter().filter(|(_, value)| !value.is_null()));
    Some(Value::Object(completed))
}

const RING_TYPES: [&str; 2] = ["m.rtc.notification", "org.matrix.msc4075.rtc.notification"];
const DEFAULT_RING_LIFETIME_MS: u64 = 30_000;

#[derive(Serialize)]
struct RingOut {
    caller_name: String,
    expires_at: f64,
}

#[derive(Serialize)]
struct RingPushOut {
    ring: Value,
    room_id: String,
    user_id: String,
}

#[derive(Serialize)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the alert flags the extension reads"
)]
struct ContentPushOut {
    title: String,
    body: String,
    text: String,
    sender: String,
    sender_id: Option<String>,
    event_id: Option<String>,
    room_id: String,
    user_id: String,
    sounds: bool,
    noisy: bool,
    invite: bool,
    active_elsewhere: bool,
    group: bool,
    sender_avatar: Option<String>,
    room_avatar: Option<String>,
    image: Option<PushImage>,
    members: Option<u64>,
}

#[derive(Serialize)]
struct DiscardOut {
    discard: bool,
}

#[derive(Serialize)]
struct ReadOut {
    clear: bool,
    room_id: Option<String>,
}

#[derive(Serialize)]
struct ReadPushOut {
    read: ReadOut,
    user_id: String,
}

/// A field kept as received when present, `null` included.
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

#[serde_as]
#[derive(Deserialize)]
struct RingEvent {
    #[serde(rename = "type")]
    kind: String,
    content: RingContent,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    origin_server_ts: Option<u64>,
}

#[serde_as]
#[derive(Deserialize)]
struct RingContent {
    notification_type: String,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    sender_ts: Option<u64>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    lifetime: Option<u64>,
}

fn ring(event: &Value, caller: &str) -> Option<Value> {
    let event = RingEvent::deserialize(event).ok()?;
    if !RING_TYPES.contains(&event.kind.as_str()) || event.content.notification_type != "ring" {
        return None;
    }
    let sent = event.content.sender_ts.or(event.origin_server_ts)?;
    let lifetime = event.content.lifetime.unwrap_or(DEFAULT_RING_LIFETIME_MS);
    #[expect(
        clippy::cast_precision_loss,
        reason = "milliseconds since 1970 fit an f64 exactly for millennia"
    )]
    let expires_at = sent.saturating_add(lifetime) as f64 / 1000.0;
    serde_json::to_value(RingOut {
        caller_name: caller.to_owned(),
        expires_at,
    })
    .ok()
}

#[serde_as]
#[derive(Deserialize)]
struct Device {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    tweaks: Option<Map<String, Value>>,
}

#[serde_as]
#[derive(Default, Deserialize)]
struct Devices {
    #[serde_as(deserialize_as = "DefaultOnError<VecSkipError<_>>")]
    #[serde(default)]
    devices: Vec<Device>,
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

#[serde_as]
#[derive(Deserialize)]
struct PushTarget {
    #[serde(default, deserialize_with = "present")]
    user_id: Option<Value>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    room_id: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    event_id: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    room_name: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    sender: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    sender_display_name: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    counts: Option<Counts>,
}

#[serde_as]
#[derive(Deserialize)]
struct Counts {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    unread: Option<u64>,
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

#[derive(Deserialize)]
struct InviteEvent {
    #[serde(rename = "type")]
    kind: String,
    content: InviteContent,
}

#[serde_as]
#[derive(Deserialize)]
struct InviteContent {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    membership: Option<String>,
}

const HIDDEN_BODY: &str = "New message";
const ENCRYPTED_BODY: &str = "Encrypted message";
const INVITE_TITLE: &str = "New Invitation";

fn is_invite(event: &Value) -> bool {
    InviteEvent::deserialize(event).is_ok_and(|event| {
        event.kind == "m.room.member" && event.content.membership.as_deref() == Some("invite")
    })
}

fn invite_body(sender: &str, room_name: &str) -> String {
    match (sender.is_empty(), room_name.is_empty()) {
        (false, false) => format!("{sender} invites you to {room_name}"),
        (false, true) => format!("from {sender}"),
        (true, false) => format!("to {room_name}"),
        (true, true) => String::new(),
    }
}

fn message_text(settings: &Policy, event: Option<&Value>, encrypted: bool) -> String {
    let fallback = if encrypted {
        ENCRYPTED_BODY
    } else {
        HIDDEN_BODY
    };
    if !settings.content {
        return HIDDEN_BODY.to_owned();
    }
    if encrypted && !settings.encrypted_content {
        return ENCRYPTED_BODY.to_owned();
    }
    event
        .and_then(|event| ClearEvent::deserialize(event).ok())
        .map_or(fallback, |event| event.content.body)
        .to_owned()
}

async fn signed_in(root: &Path, user: &str) -> Option<(String, String)> {
    let bytes = FileSessionStore::new(root).load().await.ok()??;
    let (registry, _) = AccountRegistry::from_bytes(&bytes, root.to_str()?).ok()?;
    // Never select an arbitrary saved account for a push, including after logout.
    let account = registry.accounts.iter().find(|account| {
        !account.needs_reauth
            && registry.active_account_id.as_deref() == Some(account.account_id.as_str())
            && account.session.credentials.user_id() == user
    })?;
    Some((
        account.account_id.clone(),
        account.session.credentials.device_id(),
    ))
}

async fn clear_event(
    session: Option<&PushSession>,
    notification: &Value,
    encrypted: bool,
) -> ColdPush {
    if !encrypted {
        return ColdPush::Clear(notification.to_string());
    }
    let mut event = notification.clone();
    let Some(event_object) = event.as_object_mut() else {
        return ColdPush::Undecryptable;
    };
    event_object
        .entry("origin_server_ts")
        .or_insert(Value::from(0));
    match session {
        Some(session) => session.decrypt(&event.to_string()).await,
        None => ColdPush::Undecryptable,
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "policy and account are rechecked in order after each await"
)]
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
    let room_id = target.room_id.as_deref().filter(|room| !room.is_empty());
    let (account_id, device_id) = signed_in(root, &user).await?;
    if target.counts.and_then(|counts| counts.unread) == Some(0) {
        return serde_json::to_value(ReadPushOut {
            read: ReadOut {
                clear: settings.clear_on_read,
                room_id: room_id.map(str::to_owned),
            },
            user_id: user,
        })
        .ok();
    }
    let room_id = room_id?;
    let session = Box::pin(PushSession::open(root, &user, &device_id, room_id)).await;
    let fetched = match (target.kind.as_deref(), target.event_id.as_deref(), &session) {
        (None, Some(event_id), Some(session)) if !event_id.is_empty() => {
            Box::pin(session.fetch(event_id)).await
        }
        _ => PushFetchView::Unavailable,
    };
    let (completed, fetched_encrypted, fetched_noisy) = match fetched {
        PushFetchView::Discard => return serde_json::to_value(DiscardOut { discard: true }).ok(),
        PushFetchView::Event { event } => {
            (complete(notification, &event), event.encrypted, event.noisy)
        }
        PushFetchView::Unavailable => (None, false, false),
    };
    let notification = completed.as_ref().unwrap_or(notification);
    let target = PushTarget::deserialize(notification).ok()?;
    let ciphertext = target.kind.as_deref() == Some("m.room.encrypted");
    let encrypted = ciphertext || fetched_encrypted;
    let event = match Box::pin(clear_event(session.as_ref(), notification, ciphertext)).await {
        ColdPush::Discard => return serde_json::to_value(DiscardOut { discard: true }).ok(),
        ColdPush::Clear(clear) => serde_json::from_str(&clear).ok(),
        ColdPush::Unevaluated | ColdPush::NeedsKey { .. } | ColdPush::Undecryptable => None,
    };
    let sender_id = target.sender.filter(|sender| !sender.is_empty());
    let sender = match &session {
        Some(session) => {
            session
                .sender_name(sender_id.as_deref(), target.sender_display_name.as_deref())
                .await
        }
        None => push_sender_name(sender_id.as_deref(), target.sender_display_name.as_deref()),
    };
    if let Some(ring) = event.as_ref().and_then(|event| ring(event, &sender)) {
        return serde_json::to_value(RingPushOut {
            ring,
            room_id: room_id.to_owned(),
            user_id: user,
        })
        .ok();
    }
    let room_name = target.room_name.unwrap_or_default();
    let invite = event.as_ref().is_some_and(is_invite);
    let title = if invite {
        INVITE_TITLE
    } else {
        [room_name.as_str(), sender.as_str()]
            .into_iter()
            .find(|name| !name.is_empty())
            .unwrap_or(HIDDEN_BODY)
    }
    .to_owned();
    // Recheck policy after decryption, which may overlap a settings change.
    let current = policy(root);
    if !current.enabled {
        return None;
    }
    let text = if invite {
        invite_body(&sender, &room_name)
    } else {
        message_text(&current, event.as_ref(), encrypted)
    };
    let body = if invite || sender.is_empty() {
        text.clone()
    } else {
        format!("{sender}: {text}")
    };
    let previews = current.content && (!encrypted || current.encrypted_content);
    let content = event
        .as_ref()
        .and_then(|event| event.get("content"))
        .filter(|_| previews);
    let active_elsewhere = match &session {
        Some(session) if !invite && current.quiet_when_active_elsewhere => {
            Box::pin(session.active_elsewhere(sable_core::notifications::inactive_here_ms(root)))
                .await
        }
        _ => false,
    };
    let media = match (sender_id.as_deref(), &session) {
        (Some(sender), Some(session)) if !invite => {
            Box::pin(session.media(Some(sender), target.sender_display_name.as_deref(), content))
                .await
        }
        _ => PushMedia::default(),
    };
    let members = session.as_ref().and_then(PushSession::joined_members);
    drop(session);
    if signed_in(root, &user).await != Some((account_id, device_id)) {
        return None;
    }
    let noisy = event
        .as_ref()
        .and_then(|event| event.get(sable_core::notifications::NOISY_KEY))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || fetched_noisy
        || rings(notification);
    serde_json::to_value(ContentPushOut {
        title,
        body,
        text,
        sender,
        sender_id,
        event_id: target.event_id.filter(|event| !event.is_empty()),
        room_id: room_id.to_owned(),
        user_id: user,
        sounds: current.sounds,
        noisy,
        invite,
        active_elsewhere,
        group: !room_name.is_empty(),
        sender_avatar: media.sender,
        room_avatar: media.room,
        image: media.image,
        members,
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
            sable_core::notifications::settle_refreshes(Box::pin(tokio::time::timeout(
                std::time::Duration::from_secs(20),
                render(Path::new(root), &payload),
            )))
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

    #[tokio::test]
    async fn unavailable_keys_still_allow_a_generic_alert() {
        let notification = json!({"type":"m.room.encrypted","content":{}});
        assert_eq!(
            clear_event(None, &notification, true).await,
            ColdPush::Undecryptable
        );
        assert_eq!(
            clear_event(None, &notification, false).await,
            ColdPush::Clear(notification.to_string())
        );
    }

    #[test]
    fn only_a_ring_notification_is_a_ring() {
        let event = |kind: &str, notification_type: &str| {
            json!({"type":kind,"sender":"@bob:example.org","origin_server_ts":2_000,
                "content":{"notification_type":notification_type}})
        };
        let named = "Bob";

        assert_eq!(
            ring(&event("org.matrix.msc4075.rtc.notification", "ring"), named),
            Some(json!({"caller_name":"Bob","expires_at":32.0}))
        );
        assert!(ring(&event("m.rtc.notification", "notification"), named).is_none());
        assert!(ring(&event("m.room.message", "ring"), named).is_none());
        assert_eq!(
            ring(
                &event("m.rtc.notification", "ring"),
                &push_sender_name(Some("@bob:example.org"), Some("\u{200b}\u{2800}"))
            ),
            Some(json!({ "caller_name": "@bob:example.org", "expires_at": 32.0 }))
        );
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
    fn a_fetched_event_completes_an_event_id_only_push() {
        let push = json!({"room_id":"!room:example.org","event_id":"$e","counts":{"unread":2}});
        let event = PushEventView {
            event_type: "m.rtc.notification".to_owned(),
            content: json!({"notification_type":"ring","sender_ts":1_000}),
            sender: "@bob:example.org".to_owned(),
            sender_display_name: Some("Bob".to_owned()),
            room_name: "Lounge".to_owned(),
            room_avatar_url: None,
            encrypted: true,
            noisy: false,
        };

        let completed = complete(&push, &event).unwrap();
        assert_eq!(completed["event_id"], "$e");
        assert_eq!(completed["counts"]["unread"], 2);
        assert_eq!(completed["type"], "m.rtc.notification");
        assert_eq!(completed["sender_display_name"], "Bob");
        assert!(completed.get("room_avatar_url").is_none());
        assert_eq!(
            ring(&completed, "Bob"),
            Some(json!({"caller_name":"Bob","expires_at":31.0}))
        );
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
        let body = async |payload: &Value| {
            render(&root, payload)
                .await
                .and_then(|value| value.get("body").cloned())
        };
        assert_eq!(body(&payload).await, Some(json!("private")));
        let unfetchable =
            json!({"user_id":"@alice:example.org","room_id":"!room:example.org","event_id":"$e"});
        assert_eq!(body(&unfetchable).await, Some(json!("New message")));
        payload["user_id"] = json!("@other:example.org");
        assert!(render(&root, &payload).await.is_none());
        payload["user_id"] = json!("@alice:example.org");
        payload["notification"]["type"] = json!("m.room.encrypted");
        assert_eq!(body(&payload).await, Some(json!("Encrypted message")));
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
        assert_eq!(body(&payload).await, Some(json!("New message")));
        let ringing = json!({"user_id":"@alice:example.org","notification":{
            "room_id":"!room:example.org","type":"m.rtc.notification","sender":"@bob:example.org",
            "sender_display_name":"\u{200b}\u{2800}",
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

    #[tokio::test]
    async fn titles_invites_and_read_pushes_follow_the_android_alerts() {
        let root =
            std::env::temp_dir().join(format!("sable-push-shape-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let policy = |clear_on_read: bool| json!({"enabled":true,"content":true,"encrypted_content":false,"sounds":true,"clear_on_read":clear_on_read});
        std::fs::write(root.join("push-policy.json"), policy(true).to_string()).unwrap();
        let registry = json!({"version":1,"active_account_id":"a1","next_account_id":2,"accounts":[{
            "account_id":"a1","store_id":"old","needs_reauth":false,
            "session":{"homeserver":"https://example.org","credentials":{
                "kind":"password","user_id":"@alice:example.org","device_id":"A","access_token":"test"
            }}
        }]});
        FileSessionStore::new(&root)
            .save(registry.to_string().into_bytes())
            .await
            .unwrap();
        let push = |notification: Value| json!({"user_id":"@alice:example.org","notification":notification});

        let message = render(
            &root,
            &push(json!({
                "room_id":"!room:example.org","type":"m.room.message","event_id":"$e",
                "room_name":"Lounge","sender":"@bob:example.org","sender_display_name":"Bob",
                "content":{"body":"hi"}
            })),
        )
        .await
        .unwrap();
        assert_eq!(message["title"], "Lounge");
        assert_eq!(message["body"], "Bob: hi");
        assert_eq!(message["event_id"], "$e");
        assert_eq!(message["group"], true);
        assert_eq!(message["invite"], false);

        let unnamed = render(
            &root,
            &push(json!({
                "room_id":"!dm:example.org","type":"m.room.message","sender":"@bob:example.org",
                "sender_display_name":"\u{200b}\u{2800}",
                "content":{"body":"hi"}
            })),
        )
        .await
        .unwrap();
        assert_eq!(unnamed["title"], "@bob:example.org");
        assert_eq!(unnamed["group"], false);

        let invite = render(
            &root,
            &push(json!({
                "room_id":"!room:example.org","type":"m.room.member","room_name":"Lounge",
                "sender":"@bob:example.org","sender_display_name":"Bob",
                "content":{"membership":"invite"}
            })),
        )
        .await
        .unwrap();
        assert_eq!(invite["title"], "New Invitation");
        assert_eq!(invite["body"], "Bob invites you to Lounge");
        assert_eq!(invite["invite"], true);

        let read = render(
            &root,
            &push(json!({"room_id":"!room:example.org","counts":{"unread":0}})),
        )
        .await
        .unwrap();
        assert_eq!(
            read["read"],
            json!({"clear":true,"room_id":"!room:example.org"})
        );
        let account_read = render(&root, &push(json!({"counts":{"unread":0}})))
            .await
            .unwrap();
        assert_eq!(account_read["read"], json!({"clear":true,"room_id":null}));
        std::fs::write(root.join("push-policy.json"), policy(false).to_string()).unwrap();
        let kept = render(&root, &push(json!({"counts":{"unread":0}})))
            .await
            .unwrap();
        assert_eq!(kept["read"]["clear"], false);
        assert!(
            render(
                &root,
                &json!({"user_id":"@other:example.org","notification":{"counts":{"unread":0}}})
            )
            .await
            .is_none()
        );
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
            ring(&event, "@bob:x")
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
            "",
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
