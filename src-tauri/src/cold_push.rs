use std::sync::{Arc, OnceLock};

use jni::objects::{JClass, JString};
use jni::{Env, EnvUnowned};
use sable_core::Core;
use sable_core::notifications::{ColdPush, settle_refreshes};
use sable_core::protocol::PushFetchView;

pub static CORE: OnceLock<Arc<Core>> = OnceLock::new();

const DISCARD: &str = "discard";
const DISCARD_UNEVALUATED: &str = "discard-unevaluated";
const NEEDS_KEY: &str = "needs-key";
const NEEDS_KEY_QUIETLY: &str = "needs-key-quietly";

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeDecryptPush<'frame>(
    unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
    event_json: JString<'frame>,
) -> JString<'frame> {
    decrypt_push(
        unowned_env,
        &store_dir,
        &user_id,
        &device_id,
        &room_id,
        &event_json,
        true,
    )
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeDecryptPushLocally<'frame>(
    unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
    event_json: JString<'frame>,
) -> JString<'frame> {
    decrypt_push(
        unowned_env,
        &store_dir,
        &user_id,
        &device_id,
        &room_id,
        &event_json,
        false,
    )
}

fn decrypt_push<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    store_dir: &JString<'frame>,
    user_id: &JString<'frame>,
    device_id: &JString<'frame>,
    room_id: &JString<'frame>,
    event_json: &JString<'frame>,
    fetch_keys: bool,
) -> JString<'frame> {
    let result = unowned_env.with_env(|env: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let user_id = user_id.to_string();
        let device_id = device_id.to_string();
        let room_id = room_id.to_string();
        let event_json = event_json.to_string();
        let decrypt = async {
            bounded(
                &data_dir,
                std::time::Duration::from_secs(20),
                sable_core::notifications::decrypt_cold_push(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &room_id,
                    &event_json,
                    fetch_keys,
                ),
            )
            .await
            .unwrap_or(ColdPush::Undecryptable)
        };
        let result = block_on(CORE.get().is_some(), decrypt).unwrap_or(ColdPush::Undecryptable);

        JString::from_str(env, encode(result))
    });

    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

/// A cancelled push may leave its cached client half-way through a request.
async fn bounded<T>(
    data_dir: &str,
    limit: std::time::Duration,
    operation: impl Future<Output = T>,
) -> Option<T> {
    let result = settle_refreshes(Box::pin(tokio::time::timeout(limit, operation)))
        .await
        .ok();
    if result.is_none() {
        sable_core::notifications::evict_push_cache(
            &sable_core::notifications::cold_push_store_dir(std::path::Path::new(data_dir)),
        );
    }
    result
}

/// The cached push client's background tasks need a runtime that outlives each call.
fn cold_runtime() -> Option<&'static tokio::runtime::Runtime> {
    static RUNTIME: std::sync::OnceLock<Option<tokio::runtime::Runtime>> =
        std::sync::OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .ok()
        })
        .as_ref()
}

fn block_on<T>(live: bool, future: impl Future<Output = T>) -> Option<T> {
    if live {
        return Some(tauri::async_runtime::block_on(future));
    }
    cold_runtime().map(|runtime| runtime.block_on(future))
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeFetchPush<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
    event_id: JString<'frame>,
) -> JString<'frame> {
    let result = unowned_env.with_env(|env: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let user_id = user_id.to_string();
        let device_id = device_id.to_string();
        let room_id = room_id.to_string();
        let event_id = event_id.to_string();
        let fetch = async {
            bounded(
                &data_dir,
                std::time::Duration::from_secs(20),
                sable_core::notifications::fetch_cold_push_event(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &room_id,
                    &event_id,
                ),
            )
            .await
            .unwrap_or(PushFetchView::Unavailable)
        };
        let result = block_on(CORE.get().is_some(), fetch).unwrap_or(PushFetchView::Unavailable);

        JString::from_str(env, encode_fetch(&result))
    });

    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeActiveElsewhere<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
) -> jni::sys::jboolean {
    let result = unowned_env.with_env(|_env: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let user_id = user_id.to_string();
        let device_id = device_id.to_string();
        let room_id = room_id.to_string();
        let check = async {
            bounded(
                &data_dir,
                std::time::Duration::from_secs(5),
                sable_core::notifications::cold_push_active_elsewhere(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &room_id,
                ),
            )
            .await
            .unwrap_or(false)
        };
        let active = block_on(CORE.get().is_some(), check).unwrap_or(false);
        Ok(jni::sys::jboolean::from(active))
    });

    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeReadRooms<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    seed_room_id: JString<'frame>,
    room_ids: JString<'frame>,
) -> JString<'frame> {
    let result = unowned_env.with_env(|env: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let user_id = user_id.to_string();
        let device_id = device_id.to_string();
        let seed_room_id = seed_room_id.to_string();
        let room_ids = serde_json::from_str::<Vec<String>>(&room_ids.to_string()).ok();
        let read = async {
            let room_ids = room_ids?;
            bounded(&data_dir, std::time::Duration::from_secs(5), async {
                let session = sable_core::notifications::cold_push_session(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &seed_room_id,
                )
                .await?;
                session.read_rooms(&room_ids).await
            })
            .await
            .flatten()
        };
        let read = block_on(CORE.get().is_some(), read).flatten();
        JString::from_str(
            env,
            read.map_or_else(String::new, |rooms| {
                serde_json::to_string(&rooms).unwrap_or_default()
            }),
        )
    });
    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

/// An empty `sender` skips the avatars, an empty `content` the message's image.
#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativePushMedia<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
    sender: JString<'frame>,
    payload_name: JString<'frame>,
    content: JString<'frame>,
) -> JString<'frame> {
    let result = unowned_env.with_env(|env: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let user_id = user_id.to_string();
        let device_id = device_id.to_string();
        let room_id = room_id.to_string();
        let sender = sender.to_string();
        let sender = Some(sender.as_str()).filter(|sender| !sender.is_empty());
        let payload_name = payload_name.to_string();
        let content = serde_json::from_str::<serde_json::Value>(&content.to_string()).ok();
        let media = async {
            bounded(
                &data_dir,
                std::time::Duration::from_secs(5),
                sable_core::notifications::cold_push_media(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &room_id,
                    sender,
                    Some(&payload_name),
                    content.as_ref(),
                ),
            )
            .await
        };
        let media = block_on(CORE.get().is_some(), media)
            .flatten()
            .unwrap_or_else(|| sable_core::notifications::PushMedia {
                sender_name: sable_core::notifications::push_sender_name(
                    sender,
                    Some(&payload_name),
                ),
                ..Default::default()
            });

        JString::from_str(env, serde_json::to_string(&media).unwrap_or_default())
    });

    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeReply<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
    text: JString<'frame>,
    transaction_id: JString<'frame>,
    event_id: JString<'frame>,
    private_receipt: jni::sys::jboolean,
) -> jni::sys::jboolean {
    let result = unowned_env.with_env(|_: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let (user_id, device_id, room_id) = (
            user_id.to_string(),
            device_id.to_string(),
            room_id.to_string(),
        );
        let (text, transaction_id, event_id) = (
            text.to_string(),
            transaction_id.to_string(),
            event_id.to_string(),
        );
        let reply = async {
            bounded(&data_dir, std::time::Duration::from_secs(20), async {
                let session = sable_core::notifications::cold_push_session(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &room_id,
                )
                .await?;
                Some(
                    session
                        .reply(&text, &transaction_id, &event_id, private_receipt)
                        .await,
                )
            })
            .await
            .flatten()
            .unwrap_or(false)
        };
        Ok(block_on(CORE.get().is_some(), reply).unwrap_or(false))
    });
    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeMarkRead<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    user_id: JString<'frame>,
    device_id: JString<'frame>,
    room_id: JString<'frame>,
    event_id: JString<'frame>,
    private_receipt: jni::sys::jboolean,
) -> jni::sys::jboolean {
    let result = unowned_env.with_env(|_: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let data_dir = store_dir.to_string();
        let (user_id, device_id, room_id) = (
            user_id.to_string(),
            device_id.to_string(),
            room_id.to_string(),
        );
        let event_id = event_id.to_string();
        let mark_read = async {
            bounded(&data_dir, std::time::Duration::from_secs(20), async {
                let session = sable_core::notifications::cold_push_session(
                    std::path::Path::new(&data_dir),
                    &user_id,
                    &device_id,
                    &room_id,
                )
                .await?;
                Some(session.mark_read(&event_id, private_receipt).await)
            })
            .await
            .flatten()
            .unwrap_or(false)
        };
        Ok(block_on(CORE.get().is_some(), mark_read).unwrap_or(false))
    });
    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}

fn encode_fetch(result: &PushFetchView) -> String {
    match result {
        PushFetchView::Event { event } => serde_json::to_string(event).unwrap_or_default(),
        PushFetchView::Discard => DISCARD.to_owned(),
        PushFetchView::Unavailable => String::new(),
    }
}

fn encode(result: ColdPush) -> String {
    match result {
        ColdPush::Clear(clear) => clear,
        ColdPush::Discard => DISCARD.to_owned(),
        ColdPush::Unevaluated => DISCARD_UNEVALUATED.to_owned(),
        ColdPush::NeedsKey { quietly: false } => NEEDS_KEY.to_owned(),
        ColdPush::NeedsKey { quietly: true } => NEEDS_KEY_QUIETLY.to_owned(),
        ColdPush::Undecryptable => String::new(),
    }
}

#[unsafe(no_mangle)]
#[expect(unsafe_code, reason = "JNI entry point")]
pub extern "system" fn Java_moe_sable_push_PushPayloadDecryptor_nativeMaintainPush<'frame>(
    mut unowned_env: EnvUnowned<'frame>,
    _class: JClass<'frame>,
    store_dir: JString<'frame>,
    operation: JString<'frame>,
) -> JString<'frame> {
    let result = unowned_env.with_env(|env: &mut Env<'frame>| -> Result<_, jni::errors::Error> {
        let root = std::path::PathBuf::from(store_dir.to_string());
        let success = serde_json::from_str(&operation.to_string())
            .ok()
            .and_then(|operation| {
                block_on(CORE.get().is_some(), async {
                    settle_refreshes(Box::pin(tokio::time::timeout(
                        std::time::Duration::from_secs(20),
                        crate::notifications::maintain_background_push(&root, operation),
                    )))
                    .await
                    .ok()?
                    .ok()
                })?
            })
            .is_some();
        JString::from_str(env, if success { "ok" } else { "retry" })
    });
    result.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}
