use crate::api::push::PusherView;
use crate::errors::CoreError;
use matrix_sdk::Client;
#[cfg(not(target_family = "wasm"))]
use matrix_sdk::ruma::OwnedEventId;
use matrix_sdk::ruma::api::client::push::{PusherIds, PusherInit, PusherKind};
use matrix_sdk::ruma::api::client::state::get_state_event_for_key;
use matrix_sdk::ruma::events::AnySyncTimelineEvent;
use matrix_sdk::ruma::events::StateEventType;
use matrix_sdk::ruma::events::TimelineEventType;
#[cfg(not(target_family = "wasm"))]
use matrix_sdk::ruma::events::room::encrypted::OriginalSyncRoomEncryptedEvent;
use matrix_sdk::ruma::push::{Action, HttpPusherData, PushFormat};
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{EventId, MilliSecondsSinceUnixEpoch, OwnedUserId, RoomId};
use matrix_sdk_ui::notification_client::{
    NotificationClient, NotificationEvent, NotificationItem, NotificationProcessSetup,
    NotificationStatus, RawNotificationEvent,
};

use url::Url;

use crate::preview;
use crate::protocol::{NotificationView, PushEventView, PushFetchView};
#[cfg(not(target_family = "wasm"))]
use crate::session::{AccountRegistry, PersistedAccount};
#[cfg(not(target_family = "wasm"))]
use crate::store::{FileSessionStore, SessionStore};

pub(crate) const GATEWAY_PATH: &str = "/_matrix/push/v1/notify";

pub(crate) async fn pusher_display_name(client: &Client, fallback: String) -> String {
    let Some(device_id) = client.device_id() else {
        return fallback;
    };
    let Ok(devices) = client.devices().await else {
        return fallback;
    };
    devices
        .devices
        .iter()
        .find(|device| device.device_id == device_id)
        .and_then(|device| device.display_name.as_deref())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Sable")
        .to_owned()
}

/// Resolve Android's app-data root to the session and SDK stores under `files`.
#[cfg(not(target_family = "wasm"))]
#[must_use]
fn cold_push_store_dir(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("files")
}

#[cfg(not(target_family = "wasm"))]
fn push_account<'a>(
    accounts: &'a AccountRegistry,
    user_id: &str,
    device_id: &str,
) -> Option<&'a PersistedAccount> {
    accounts.accounts.iter().find(|account| {
        !account.needs_reauth
            && account.session.credentials.user_id() == user_id
            && account.session.credentials.device_id() == device_id
    })
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, PartialEq, Eq)]
pub enum ColdPush {
    Clear(String),
    Discard,
    NeedsKey { quietly: bool },
    Undecryptable,
}

/// Decrypt an Android push.
#[cfg(not(target_family = "wasm"))]
pub async fn decrypt_cold_push(
    data_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
    fetch_keys: bool,
) -> ColdPush {
    let store_dir = cold_push_store_dir(data_dir);
    let Some(host) = push_host(&store_dir, user_id, device_id).await else {
        return ColdPush::Undecryptable;
    };
    let decrypt = || {
        let key_fetch = if fetch_keys {
            host.key_fetch()
        } else {
            KeyFetch::Never
        };
        Box::pin(decrypt_push_event(
            host.client(),
            key_fetch,
            room_id,
            event_json,
        ))
    };
    let result = decrypt().await;
    match result {
        ColdPush::NeedsKey { quietly: true } if fetch_keys && !host.may_sync() => ColdPush::Discard,
        ColdPush::NeedsKey { .. } if fetch_keys && !host.may_sync() => ColdPush::Undecryptable,
        ColdPush::Undecryptable | ColdPush::NeedsKey { .. }
            if fetch_keys && host.refresh().await =>
        {
            decrypt().await
        }
        result => result,
    }
}

/// Decrypt using the same session and SDK stores as the application. Callers
/// must bound the operation to the platform's notification processing budget.
#[cfg(not(target_family = "wasm"))]
pub async fn decrypt_push_from_store(
    store_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> Option<String> {
    match cold_push_from_store(store_dir, user_id, device_id, room_id, event_json).await {
        ColdPush::Clear(clear) => Some(clear),
        ColdPush::Discard | ColdPush::NeedsKey { .. } | ColdPush::Undecryptable => None,
    }
}

#[cfg(not(target_family = "wasm"))]
async fn cold_push_from_store(
    store_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> ColdPush {
    let Some(client) = restore_push_client(store_dir, user_id, device_id).await else {
        return ColdPush::Undecryptable;
    };
    Box::pin(decrypt_push_event(
        &client,
        KeyFetch::Never,
        room_id,
        event_json,
    ))
    .await
}

#[cfg(not(target_family = "wasm"))]
#[derive(Clone, Default)]
struct PendingRefreshes(std::sync::Arc<std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>>);

#[cfg(not(target_family = "wasm"))]
tokio::task_local! {
    static PENDING_REFRESHES: PendingRefreshes;
}

#[cfg(not(target_family = "wasm"))]
pub async fn settle_refreshes<T>(operation: impl std::future::Future<Output = T>) -> T {
    let pending = PendingRefreshes::default();
    let result = PENDING_REFRESHES.scope(pending.clone(), operation).await;
    let tasks = std::mem::take(
        &mut *pending
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for task in tasks {
        let _ = task.await;
    }
    result
}

/// A notification operation owns refreshes separately from SDK background tasks.
#[cfg(not(target_family = "wasm"))]
pub struct PushClient {
    client: Client,
    owner: Option<PushOwner>,
    _lease: Option<crate::session::StoreLease>,
}

#[cfg(not(target_family = "wasm"))]
struct PushOwner {
    store: std::sync::Arc<FileSessionStore>,
    base_store: String,
    account_id: String,
}

#[cfg(not(target_family = "wasm"))]
impl std::ops::Deref for PushClient {
    type Target = Client;

    fn deref(&self) -> &Self::Target {
        &self.client
    }
}

#[cfg(not(target_family = "wasm"))]
impl PushClient {
    async fn refresh(&self) -> bool {
        let Some(owner) = &self.owner else {
            return false;
        };
        if !self.token_rejected().await {
            return false;
        }
        let client = self.client.clone();
        let store = owner.store.clone();
        let base_store = owner.base_store.clone();
        let account_id = owner.account_id.clone();
        let (sent, refreshed) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let refreshed = client.refresh_access_token().await.is_ok()
                && persist_push_session(&store, &base_store, &account_id, &client)
                    .await
                    .inspect_err(|error| tracing::error!("could not persist push session: {error}"))
                    .is_ok();
            drop(store);
            let _ = sent.send(refreshed);
        });
        let _ = PENDING_REFRESHES.try_with(|pending| {
            pending
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(task);
        });
        refreshed.await.unwrap_or(false)
    }

    async fn token_rejected(&self) -> bool {
        matches!(
            self.client.whoami().await,
            Err(error) if matches!(
                error.client_api_error_kind(),
                Some(matrix_sdk::ruma::api::error::ErrorKind::UnknownToken(_))
            )
        )
    }

    /// Retry a failed notification request once with refreshed credentials.
    ///
    /// # Errors
    /// Returns the request error when refresh is unavailable or the retry fails.
    pub async fn retry<T, E, F: std::future::Future<Output = Result<T, E>>>(
        &self,
        request: impl Fn() -> F,
    ) -> Result<T, E> {
        let result = request().await;
        if result.is_err() && self.refresh().await {
            request().await
        } else {
            result
        }
    }
}

/// Restore a notification login, rotating credentials only while holding ownership.
#[cfg(not(target_family = "wasm"))]
pub async fn restore_push_client(
    store_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
) -> Option<PushClient> {
    let host = push_host(store_dir, user_id, device_id).await?;
    Some(match host {
        PushHost::Live { client, .. } => PushClient {
            client,
            owner: None,
            _lease: None,
        },
        PushHost::Shared { client, lease } => PushClient {
            client,
            owner: None,
            _lease: Some(lease),
        },
        PushHost::Own(client) => client,
    })
}

#[cfg(not(target_family = "wasm"))]
async fn open_push_client(
    store_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
    lease: crate::session::StoreLease,
) -> Option<PushClient> {
    let directory = store_dir.to_owned();
    let owner = tokio::task::spawn_blocking(move || FileSessionStore::try_exclusive(directory))
        .await
        .ok()?
        .ok()?
        .map(std::sync::Arc::new);
    // After taking ownership, so a refresh starts from the newest tokens.
    let account = saved_push_account(store_dir, user_id, device_id).await?;
    let client = crate::session::restore_notification_client(&account.store_id, &account.session)
        .await
        .ok()?;
    let owner = match owner {
        Some(store) => Some(PushOwner {
            store,
            base_store: store_dir.to_str()?.to_owned(),
            account_id: account.account_id,
        }),
        None => None,
    };
    Some(PushClient {
        client,
        owner,
        _lease: Some(lease),
    })
}

#[cfg(not(target_family = "wasm"))]
async fn saved_push_account(
    store_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
) -> Option<PersistedAccount> {
    let stored = FileSessionStore::new(store_dir).load().await.ok()??;
    let base_store = store_dir.to_str()?;
    let (mut accounts, _) = AccountRegistry::from_bytes(&stored, base_store).ok()?;
    accounts.reanchor_stores(base_store);
    push_account(&accounts, user_id, device_id).cloned()
}

#[cfg(not(target_family = "wasm"))]
enum PushHost {
    Live {
        client: Client,
        sync_service: std::sync::Arc<matrix_sdk_ui::sync_service::SyncService>,
    },
    Shared {
        client: Client,
        lease: crate::session::StoreLease,
    },
    Own(PushClient),
}

#[cfg(not(target_family = "wasm"))]
impl PushHost {
    fn client(&self) -> &Client {
        match self {
            Self::Live { client, .. } | Self::Shared { client, .. } => client,
            Self::Own(push) => push,
        }
    }

    /// A client of its own may only sync the store when no other process has it open.
    const fn may_sync(&self) -> bool {
        match self {
            Self::Live { .. } | Self::Shared { .. } => true,
            Self::Own(push) => push.owner.is_some(),
        }
    }

    fn key_fetch(&self) -> KeyFetch {
        match self {
            Self::Live { sync_service, .. } => KeyFetch::Live(sync_service.clone()),
            _ if self.may_sync() => KeyFetch::Cold,
            _ => KeyFetch::Never,
        }
    }

    async fn refresh(&self) -> bool {
        match self {
            Self::Own(push) => push.refresh().await,
            _ => false,
        }
    }
}

#[cfg(not(target_family = "wasm"))]
const RESTORE_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// The core that owns the store opens the client, so a store never has two.
#[cfg(not(target_family = "wasm"))]
async fn push_host(
    store_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
) -> Option<PushHost> {
    let Some(core) = crate::Core::owning(store_dir) else {
        let store_id = saved_push_account(store_dir, user_id, device_id)
            .await?
            .store_id;
        let lease = crate::session::store_lease(&store_id).await;
        return open_push_client(store_dir, user_id, device_id, lease)
            .await
            .map(PushHost::Own);
    };
    let _ = tokio::time::timeout(RESTORE_WAIT, core.restore_lock.lock()).await;
    if let Some(host) = live_push_host(&core, user_id, device_id).await {
        return Some(host);
    }
    let accounts = core.accounts().await.ok()?;
    let account = push_account(&accounts, user_id, device_id)?;
    let lease = crate::session::store_lease(&account.store_id).await;
    if let Some(host) = live_push_host(&core, user_id, device_id).await {
        return Some(host);
    }
    let client = core.saved_account_client(account, &lease).await.ok()?;
    Some(PushHost::Shared { client, lease })
}

#[cfg(not(target_family = "wasm"))]
async fn live_push_host(core: &crate::Core, user_id: &str, device_id: &str) -> Option<PushHost> {
    core.session
        .read()
        .await
        .as_ref()
        .filter(|session| is_login(&session.client, user_id, device_id))
        .map(|session| PushHost::Live {
            client: session.client.clone(),
            sync_service: session.sync_service.clone(),
        })
}

#[cfg(not(target_family = "wasm"))]
fn is_login(client: &Client, user_id: &str, device_id: &str) -> bool {
    client.user_id().is_some_and(|id| id == user_id)
        && client.device_id().is_some_and(|id| id == device_id)
}

#[cfg(not(target_family = "wasm"))]
async fn persist_push_session(
    store: &FileSessionStore,
    base_store: &str,
    account_id: &str,
    client: &Client,
) -> Result<(), crate::store::StoreError> {
    let stored = store
        .load()
        .await?
        .ok_or(crate::store::StoreError::Invalid("push session is missing"))?;
    let (mut accounts, _) = AccountRegistry::from_bytes(&stored, base_store)?;
    let Some(account) = accounts
        .accounts
        .iter_mut()
        .find(|account| account.account_id == account_id && !account.needs_reauth)
    else {
        return Ok(());
    };
    let Some(current) = crate::session::current_session(client, account.session.homeserver.clone())
    else {
        return Ok(());
    };
    account.session = current.keeping_endpoint_of(&account.session);
    let bytes = serde_json::to_vec(&accounts)?;
    store.save(bytes).await
}

#[cfg(not(target_family = "wasm"))]
enum KeyFetch {
    Never,
    Live(std::sync::Arc<matrix_sdk_ui::sync_service::SyncService>),
    Cold,
}

#[cfg(not(target_family = "wasm"))]
async fn decrypt_push_event(
    client: &Client,
    key_fetch: KeyFetch,
    room_id: &str,
    event_json: &str,
) -> ColdPush {
    let every_encrypted = every_encrypted_event_pushed(client).await;
    let undecryptable = if every_encrypted {
        ColdPush::Discard
    } else {
        ColdPush::Undecryptable
    };
    let Ok(room_id) = RoomId::parse(room_id) else {
        return ColdPush::Undecryptable;
    };
    let Some(room) = client.get_room(&room_id) else {
        return ColdPush::Undecryptable;
    };
    let Ok(event) = Raw::<OriginalSyncRoomEncryptedEvent>::from_json_string(event_json.to_owned())
    else {
        return ColdPush::Undecryptable;
    };
    let push_context = room.push_context().await.ok().flatten();
    let Ok(decrypted) = room.decrypt_event(&event, push_context.as_ref()).await else {
        return undecryptable;
    };

    match &decrypted.kind {
        matrix_sdk::deserialized_responses::TimelineEventKind::Decrypted(clear) => {
            let actions = decrypted.push_actions();
            return if actions.is_some_and(|actions| !notifies(actions)) {
                ColdPush::Discard
            } else {
                let noisy = actions.is_some_and(|actions| {
                    actions
                        .iter()
                        .any(|action| action.sound().is_some() || action.is_highlight())
                });
                ColdPush::Clear(marked_noisy(clear.event.json().get(), noisy))
            };
        }
        matrix_sdk::deserialized_responses::TimelineEventKind::UnableToDecrypt {
            utd_info, ..
        } if utd_info.reason.is_missing_room_key() => {}
        matrix_sdk::deserialized_responses::TimelineEventKind::UnableToDecrypt { .. }
        | matrix_sdk::deserialized_responses::TimelineEventKind::PlainText { .. } => {
            return undecryptable;
        }
    }

    let sync_service = match key_fetch {
        KeyFetch::Never => {
            return ColdPush::NeedsKey {
                quietly: every_encrypted,
            };
        }
        KeyFetch::Live(sync_service) => sync_service,
        KeyFetch::Cold => match crate::session::build_sync(client.clone()).await {
            Ok(sync_service) => sync_service,
            Err(_) => return undecryptable,
        },
    };
    let Some(event_id) = event.get_field::<OwnedEventId>("event_id").ok().flatten() else {
        return undecryptable;
    };
    let setup = NotificationProcessSetup::SingleProcess { sync_service };
    let Ok(notifications) = NotificationClient::new(client.clone(), setup).await else {
        return undecryptable;
    };
    match notifications.get_notification(&room_id, &event_id).await {
        Ok(NotificationStatus::Event(item)) => match item.raw_event {
            RawNotificationEvent::Timeline(clear)
                if clear.get_field::<String>("type").ok().flatten().as_deref()
                    != Some("m.room.encrypted") =>
            {
                let noisy = item.is_noisy == Some(true) || item.has_mention == Some(true);
                ColdPush::Clear(marked_noisy(clear.json().get(), noisy))
            }
            _ => undecryptable,
        },
        Ok(NotificationStatus::EventFilteredOut | NotificationStatus::EventRedacted) => {
            ColdPush::Discard
        }
        Ok(NotificationStatus::EventNotFound) | Err(_) => undecryptable,
    }
}

#[cfg(not(target_family = "wasm"))]
fn marked_noisy(clear: &str, noisy: bool) -> String {
    if !noisy {
        return clear.to_owned();
    }
    let Ok(mut event) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(clear)
    else {
        return clear.to_owned();
    };
    event.insert(NOISY_KEY.to_owned(), true.into());
    serde_json::to_string(&event).unwrap_or_else(|_| clear.to_owned())
}

#[cfg(not(target_family = "wasm"))]
pub async fn fetch_cold_push_event(
    data_dir: &std::path::Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_id: &str,
) -> PushFetchView {
    let (Ok(room_id), Ok(event_id)) = (RoomId::parse(room_id), EventId::parse(event_id)) else {
        return PushFetchView::Unavailable;
    };
    let store_dir = cold_push_store_dir(data_dir);
    let Some(host) = push_host(&store_dir, user_id, device_id).await else {
        return PushFetchView::Unavailable;
    };
    let sync_service = match &host {
        PushHost::Live { sync_service, .. } => sync_service.clone(),
        _ if !host.may_sync() => return PushFetchView::Unavailable,
        _ => match crate::session::build_sync(host.client().clone()).await {
            Ok(sync_service) => sync_service,
            Err(_) => return PushFetchView::Unavailable,
        },
    };
    let fetch = || {
        Box::pin(fetch_push_event(
            host.client(),
            sync_service.clone(),
            &room_id,
            &event_id,
        ))
    };
    let result = fetch().await;
    if matches!(result, PushFetchView::Unavailable) && host.refresh().await {
        fetch().await
    } else {
        result
    }
}

pub async fn fetch_push_event(
    client: &Client,
    sync_service: std::sync::Arc<matrix_sdk_ui::sync_service::SyncService>,
    room_id: &RoomId,
    event_id: &EventId,
) -> PushFetchView {
    let setup = NotificationProcessSetup::SingleProcess { sync_service };
    let Ok(notifications) = NotificationClient::new(client.clone(), setup).await else {
        return PushFetchView::Unavailable;
    };
    match notifications.get_notification(room_id, event_id).await {
        Ok(NotificationStatus::Event(item)) => {
            let Some(mut event) = push_event_view(*item) else {
                return PushFetchView::Unavailable;
            };
            if event.sender_display_name.is_none() {
                event.sender_display_name = Some(sender_name(client, room_id, &event.sender).await);
            }
            PushFetchView::Event { event }
        }
        Ok(NotificationStatus::EventFilteredOut | NotificationStatus::EventRedacted) => {
            PushFetchView::Discard
        }
        Ok(NotificationStatus::EventNotFound) | Err(_) => PushFetchView::Unavailable,
    }
}

async fn sender_name(client: &Client, room_id: &RoomId, sender: &str) -> String {
    let request = get_state_event_for_key::v3::Request::new(
        room_id.to_owned(),
        StateEventType::RoomMember,
        sender.to_owned(),
    );
    let fetched = client.send(request).await.ok().and_then(|response| {
        serde_json::from_str::<serde_json::Value>(response.event_or_content.get()).ok()
    });
    fetched
        .as_ref()
        .map(|value| value.get("content").unwrap_or(value))
        .and_then(|content| content.get("displayname")?.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(sender)
        .to_owned()
}

fn push_event_view(item: NotificationItem) -> Option<PushEventView> {
    let raw = match &item.raw_event {
        RawNotificationEvent::Timeline(raw) => raw.json().get(),
        RawNotificationEvent::Invite(raw) => raw.json().get(),
    };
    let mut event: serde_json::Value = serde_json::from_str(raw).ok()?;
    Some(PushEventView {
        event_type: event.get("type")?.as_str()?.to_owned(),
        content: event
            .get_mut("content")
            .map(serde_json::Value::take)
            .unwrap_or_default(),
        sender: item.event.sender().to_string(),
        sender_display_name: item.sender_display_name,
        room_name: item.room_computed_display_name,
        room_avatar_url: item.room_avatar_url,
    })
}

pub use crate::push_rules::notifies;

#[must_use]
pub fn uses_direct_push_rules(room: &matrix_sdk::Room) -> bool {
    room.direct_targets_length() > 0
}

pub async fn every_encrypted_event_pushed(client: &Client) -> bool {
    client
        .account()
        .push_rules()
        .await
        .is_ok_and(|rules| crate::push_rules::pushes_every_encrypted_event(&rules))
}

pub async fn notification(
    client: &Client,
    setup: NotificationProcessSetup,
    room_id: &RoomId,
    event_id: &EventId,
) -> Option<NotificationView> {
    let notifications = NotificationClient::new(client.clone(), setup).await.ok()?;

    match notifications.get_notification(room_id, event_id).await {
        Ok(NotificationStatus::Event(item)) => {
            Some(view(client.user_id()?.to_owned(), room_id, event_id, *item))
        }
        _ => None,
    }
}

pub(crate) async fn foreground_notification(
    notifications: &NotificationClient,
    room: &matrix_sdk::Room,
    event_id: &EventId,
    discard_undecryptable: bool,
) -> Option<NotificationView> {
    match notifications
        .get_notification_with_context(room.room_id(), event_id)
        .await
    {
        Ok(NotificationStatus::Event(item))
            if !(discard_undecryptable && still_encrypted(&item.event)) =>
        {
            Some(view(
                room.own_user_id().to_owned(),
                room.room_id(),
                event_id,
                *item,
            ))
        }
        _ => None,
    }
}

fn still_encrypted(event: &NotificationEvent) -> bool {
    matches!(
        event,
        NotificationEvent::Timeline(event)
            if event.event_type() == TimelineEventType::RoomEncrypted
    )
}

pub(crate) fn raw_is_encrypted(raw: &Raw<AnySyncTimelineEvent>) -> bool {
    raw.get_field::<String>("type").ok().flatten().as_deref() == Some("m.room.encrypted")
}

pub(crate) async fn invite_notification(
    room: &matrix_sdk::Room,
    actions: &[Action],
) -> Option<NotificationView> {
    let invite = room.invite_details().await.ok()?;
    Some(NotificationView {
        user_id: room.own_user_id().to_owned(),
        room_id: room.room_id().to_owned(),
        event_id: None,
        room_name: room.display_name().await.ok()?.to_string(),
        room_avatar_url: room.avatar_url().map(|url| url.to_string()),
        is_direct: room.is_direct().await.unwrap_or(false),
        encrypted: room.encryption_state().is_encrypted(),
        sender: invite.inviter_id,
        sender_name: invite
            .inviter
            .as_ref()
            .and_then(|member| member.display_name().map(ToOwned::to_owned)),
        sender_avatar_url: invite
            .inviter
            .as_ref()
            .and_then(|member| member.avatar_url().map(ToString::to_string)),
        body: "invited you".to_owned(),
        mention: actions.iter().any(Action::is_highlight),
        noisy: Some(actions.iter().any(|action| action.sound().is_some())),
    })
}

/// A device token must not be handed to anything but a Matrix push gateway.
/// # Errors
///
/// When the address is not a gateway's.
pub(crate) fn gateway(url: &str) -> Result<String, CoreError> {
    let parsed = Url::parse(url).map_err(|_| "the push gateway is not a URL")?;
    let plain = parsed.scheme() != "https";
    let addressed = !parsed.username().is_empty() || parsed.password().is_some();
    if plain || addressed || parsed.fragment().is_some() || parsed.path() != GATEWAY_PATH {
        return Err(format!("{url} is not an https {GATEWAY_PATH} endpoint").into());
    }

    Ok(parsed.to_string())
}

#[derive(serde::Serialize)]
struct DefaultPayloadOut {
    user_id: String,
}

#[derive(serde::Serialize)]
struct PusherDataOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_payload: Option<DefaultPayloadOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    p256dh: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auth: Option<String>,
}

/// A cold platform notification is built from this payload, and it derives its
/// identity from `user_id`, so leaving it out stops a running app replacing it.
/// # Errors
///
/// When the gateway is not a push gateway, or the server rejects the registration.
pub async fn set_pusher(client: &Client, pusher: PusherView) -> Result<(), CoreError> {
    let mut pusher_data = HttpPusherData::new(gateway(&pusher.url)?);
    let device_display_name = pusher_display_name(client, pusher.device_display_name).await;
    if pusher.event_id_only {
        pusher_data.format = Some(PushFormat::EventIdOnly);
    }
    let user_id = client.user_id().map(ToString::to_string);
    let (endpoint, p256dh, auth) = pusher.web_push.map_or((None, None, None), |keys| {
        (Some(keys.endpoint), Some(keys.p256dh), Some(keys.auth))
    });
    pusher_data.data = serde_json::to_value(PusherDataOut {
        default_payload: user_id.clone().map(|user_id| DefaultPayloadOut { user_id }),
        user_id,
        endpoint,
        p256dh,
        auth,
    })
    .and_then(serde_json::from_value)
    .map_err(|error| error.to_string())?;

    client
        .pusher()
        .set(
            PusherInit {
                ids: PusherIds::new(pusher.pushkey, pusher.app_id),
                kind: PusherKind::Http(pusher_data),
                app_display_name: "Sable".to_owned(),
                device_display_name,
                profile_tag: None,
                lang: "en".to_owned(),
            }
            .into(),
            pusher.append,
        )
        .await
        .map_err(CoreError::backend)
}

/// # Errors
///
/// When the server rejects the removal.
pub async fn remove_pusher(
    client: &Client,
    pushkey: String,
    app_id: String,
) -> Result<(), CoreError> {
    client
        .pusher()
        .delete(PusherIds::new(pushkey, app_id))
        .await
        .map_err(CoreError::backend)
}

const BACKFILL_GRACE_MS: u64 = 60_000;
pub const NOISY_KEY: &str = "moe.sable.noisy";

#[must_use]
pub fn is_backfill(
    now: MilliSecondsSinceUnixEpoch,
    origin_server_ts: MilliSecondsSinceUnixEpoch,
) -> bool {
    let now: u64 = now.get().into();
    let sent: u64 = origin_server_ts.get().into();
    sent < now.saturating_sub(BACKFILL_GRACE_MS)
}

pub async fn is_read(room: &matrix_sdk::Room, sent: MilliSecondsSinceUnixEpoch) -> bool {
    room.unread_notification_counts().notification_count == 0
        && crate::inbox::receipt_ts(room).await.unwrap_or(0) >= u64::from(sent.get())
}

fn view(
    user_id: OwnedUserId,
    room_id: &RoomId,
    event_id: &EventId,
    item: NotificationItem,
) -> NotificationView {
    NotificationView {
        user_id,
        room_id: room_id.to_owned(),
        event_id: Some(event_id.to_owned()),
        room_name: item.room_computed_display_name,
        room_avatar_url: item.room_avatar_url,
        is_direct: item.is_direct_message_room,
        encrypted: item.is_room_encrypted.unwrap_or(false),
        sender: item.event.sender().to_owned(),
        sender_name: item.sender_display_name,
        sender_avatar_url: item.sender_avatar_url,
        body: body(&item.event),
        mention: item.has_mention.unwrap_or(false),
        noisy: item.is_noisy,
    }
}

fn body(event: &NotificationEvent) -> String {
    match event {
        NotificationEvent::Invite(_) => "invited you".to_owned(),
        NotificationEvent::Timeline(event) => preview::describe(event.as_ref()),
    }
}

#[cfg(test)]
mod tests {
    use crate::api::push::{PusherView, WebPusherView};
    use matrix_sdk::ruma::events::AnySyncTimelineEvent;
    use matrix_sdk::ruma::push::{ConditionalPushRule, RuleKind, Ruleset};
    use matrix_sdk::ruma::serde::Raw;
    use matrix_sdk::ruma::{MilliSecondsSinceUnixEpoch, UInt, owned_device_id, room_id, user_id};
    use matrix_sdk::test_utils::mocks::MatrixMockServer;
    use matrix_sdk_base::crypto::{
        olm::{Account, EncryptionSettings, InboundGroupSession, OutboundGroupSession, SenderData},
        types::EventEncryptionAlgorithm,
    };
    use matrix_sdk_test::JoinedRoomBuilder;
    use serde_json::json;

    use super::{
        ColdPush, PushHost, cold_push_store_dir, decrypt_cold_push, fetch_cold_push_event, gateway,
        is_backfill, push_account, push_host, restore_push_client,
    };
    use crate::preview::describe;
    use crate::protocol::PushFetchView;
    use crate::session::PersistedSession;
    use crate::store::{FileSessionStore, SessionStore};

    fn ts(millis: u32) -> MilliSecondsSinceUnixEpoch {
        MilliSecondsSinceUnixEpoch(UInt::from(millis))
    }

    #[test]
    fn pusher_data_omits_what_is_absent_and_nests_the_default_payload() {
        use super::{DefaultPayloadOut, PusherDataOut};
        assert_eq!(
            serde_json::to_value(PusherDataOut {
                user_id: Some("@a:b".to_owned()),
                default_payload: Some(DefaultPayloadOut {
                    user_id: "@a:b".to_owned()
                }),
                endpoint: Some("https://push.example/sub".to_owned()),
                p256dh: Some("key".to_owned()),
                auth: Some("secret".to_owned()),
            })
            .unwrap(),
            json!({
                "user_id": "@a:b",
                "default_payload": { "user_id": "@a:b" },
                "endpoint": "https://push.example/sub",
                "p256dh": "key",
                "auth": "secret",
            })
        );
        assert_eq!(
            serde_json::to_value(PusherDataOut {
                user_id: None,
                default_payload: None,
                endpoint: None,
                p256dh: None,
                auth: None,
            })
            .unwrap(),
            json!({})
        );
    }

    #[tokio::test]
    async fn pushers_use_the_current_device_name() {
        use matrix_sdk::test_utils::client::MockClientBuilder;
        use wiremock::matchers::{body_partial_json, method, path};
        use wiremock::{Mock, ResponseTemplate};

        let server = MatrixMockServer::new().await;
        let client = MockClientBuilder::new(Some(&server.uri()))
            .logged_in_with_token(
                "token".to_owned(),
                user_id!("@alice:example.org").to_owned(),
                owned_device_id!("PHONE"),
            )
            .build()
            .await;

        for (display_name, expected) in [
            (Some("  Personal phone  "), "Personal phone"),
            (Some("Work phone"), "Work phone"),
            (Some("  "), "Sable"),
            (None, "Sable"),
        ] {
            let devices = Mock::given(method("GET"))
                .and(path("/_matrix/client/v3/devices"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "devices": [
                        {"device_id": "OTHER", "display_name": "Other session"},
                        {"device_id": "PHONE", "display_name": display_name},
                    ]
                })))
                .expect(2)
                .mount_as_scoped(server.server())
                .await;
            let registration = Mock::given(method("POST"))
                .and(path("/_matrix/client/v3/pushers/set"))
                .and(body_partial_json(json!({
                    "app_display_name": "Sable",
                    "device_display_name": expected,
                })))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
                .expect(2)
                .mount_as_scoped(server.server())
                .await;

            super::set_pusher(
                &client,
                PusherView {
                    pushkey: "token".to_owned(),
                    app_id: "moe.sable.android".to_owned(),
                    url: "https://push.example/_matrix/push/v1/notify".to_owned(),
                    device_display_name: "Sable on Android".to_owned(),
                    web_push: None,
                    event_id_only: false,
                    append: false,
                },
            )
            .await
            .expect("register gateway pusher");
            crate::webpush::set_pusher(
                &client,
                WebPusherView {
                    pushkey: "key".to_owned(),
                    app_id: "moe.sable.webpush".to_owned(),
                    device_display_name: "Sable on Android".to_owned(),
                    endpoint: "https://push.example/sub".to_owned(),
                    auth: "auth".to_owned(),
                    event_id_only: true,
                },
            )
            .await
            .expect("register server pusher");
            drop(registration);
            drop(devices);
        }
    }

    #[tokio::test]
    async fn pusher_name_lookup_failure_uses_the_fallback() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, ResponseTemplate};

        let server = MatrixMockServer::new().await;
        let client = server.client_builder().build().await;
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/devices"))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({
                "errcode": "M_FORBIDDEN", "error": "Device list unavailable"
            })))
            .expect(1)
            .mount(server.server())
            .await;

        assert_eq!(
            super::pusher_display_name(&client, "Known phone".to_owned()).await,
            "Known phone"
        );
    }

    fn event(value: &serde_json::Value) -> AnySyncTimelineEvent {
        Raw::<AnySyncTimelineEvent>::from_json_string(value.to_string())
            .expect("the fixture is valid JSON")
            .deserialize()
            .expect("the fixture is a timeline event")
    }

    #[test]
    fn a_cold_push_only_opens_its_exact_authenticated_account() {
        let accounts: crate::session::AccountRegistry = serde_json::from_value(json!({
            "version": 1, "active_account_id": "a1", "next_account_id": 3,
            "accounts": [
                { "account_id": "a1", "store_id": "one", "needs_reauth": false,
                  "session": { "homeserver": "https://example.org", "credentials": {
                    "kind": "password", "user_id": "@alice:example.org", "device_id": "A", "access_token": "token"
                  }}},
                { "account_id": "a2", "store_id": "two", "needs_reauth": true,
                  "session": { "homeserver": "https://example.org", "credentials": {
                    "kind": "password", "user_id": "@alice:example.org", "device_id": "B", "access_token": "token"
                  }}}
            ]
        }))
        .expect("the account registry fixture is valid");

        assert_eq!(
            push_account(&accounts, "@alice:example.org", "A").map(|account| &account.store_id),
            Some(&"one".to_owned())
        );
        assert!(push_account(&accounts, "@alice:example.org", "B").is_none());
        assert!(push_account(&accounts, "@mallory:example.org", "A").is_none());
    }

    #[test]
    fn a_cold_push_uses_androids_files_directory() {
        assert_eq!(
            cold_push_store_dir(std::path::Path::new("/data/user/0/moe.sable.client")),
            std::path::Path::new("/data/user/0/moe.sable.client/files")
        );
    }

    const COLD_ROOM: &str = "!cold:example.org";

    struct ColdFixture {
        data_dir: std::path::PathBuf,
        client: Option<matrix_sdk::Client>,
        outbound: OutboundGroupSession,
        server: MatrixMockServer,
    }

    impl ColdFixture {
        async fn new(tag: &str, joined: JoinedRoomBuilder, rules: Option<Ruleset>) -> Self {
            let data_dir =
                std::env::temp_dir().join(format!("sable-cold-push-{tag}-{}", std::process::id()));
            let store_dir = cold_push_store_dir(&data_dir);
            let server = MatrixMockServer::new().await;
            server.mock_versions().ok().mount().await;
            let persisted: PersistedSession = serde_json::from_value(json!({
                "homeserver": server.uri(), "resolved_homeserver": server.uri(),
                "credentials": {"kind": "password", "user_id": "@alice:example.org",
                    "device_id": "A", "access_token": "test-token"}
            }))
            .unwrap();
            FileSessionStore::new(&store_dir)
                .save(serde_json::to_vec(&persisted).unwrap())
                .await
                .unwrap();
            let client =
                crate::session::restore_client(store_dir.to_str().unwrap(), &persisted, true)
                    .await
                    .unwrap();
            crate::session::restore_credentials(&client, &persisted)
                .await
                .unwrap();
            server
                .mock_sync()
                .ok_and_run(&client, |builder| {
                    if let Some(rules) = rules {
                        builder.add_global_account_data(
                            matrix_sdk_test::event_factory::EventFactory::new().push_rules(rules),
                        );
                    }
                    builder.add_joined_room(joined);
                })
                .await;
            let outbound = shared_room_key(&client).await;
            Self {
                data_dir,
                client: Some(client),
                outbound,
                server,
            }
        }

        async fn push(&self, event_type: &str, content: serde_json::Value) -> String {
            encrypted_push(&self.outbound, event_type, content).await
        }

        async fn decrypt(&self, device: &str, event: &str) -> ColdPush {
            decrypt_cold_push(
                &self.data_dir,
                "@alice:example.org",
                device,
                COLD_ROOM,
                event,
                true,
            )
            .await
        }

        async fn decrypt_locally(&self, event: &str) -> ColdPush {
            decrypt_cold_push(
                &self.data_dir,
                "@alice:example.org",
                "A",
                COLD_ROOM,
                event,
                false,
            )
            .await
        }
    }

    #[tokio::test]
    async fn a_cold_push_decrypts_from_androids_persisted_store() {
        let mut fixture = ColdFixture::new(
            "store",
            JoinedRoomBuilder::new(room_id!("!cold:example.org")),
            None,
        )
        .await;
        let event = fixture
            .push(
                "m.room.message",
                json!({"msgtype":"m.text", "body":"Cold preview 🔐"}),
            )
            .await;
        // A second SDK client must coexist with the warm application's store owner.
        let ColdPush::Clear(clear) = fixture.decrypt("A", &event).await else {
            panic!("cold decryption while the application has the store open");
        };
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&clear).unwrap()["content"]["body"],
            "Cold preview 🔐"
        );
        drop(fixture.client.take());
        assert!(matches!(
            fixture.decrypt("A", &event).await,
            ColdPush::Clear(_)
        ));
        assert_eq!(
            fixture.decrypt("OTHER", &event).await,
            ColdPush::Undecryptable
        );
        assert!(!fixture.data_dir.join("session.json").exists());

        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();
    }

    async fn shared_room_key(client: &matrix_sdk::Client) -> OutboundGroupSession {
        let room = room_id!("!cold:example.org");
        let sender = Account::new(user_id!("@sender:example.org"));
        let keys = sender.identity_keys();
        let outbound = OutboundGroupSession::new(
            owned_device_id!("SENDER"),
            std::sync::Arc::new(keys),
            room,
            EncryptionSettings::default(),
        )
        .unwrap();
        let inbound = InboundGroupSession::new(
            outbound.sender_key(),
            keys.ed25519,
            room,
            &outbound.session_key().await,
            SenderData::unknown(),
            None,
            EventEncryptionAlgorithm::MegolmV1AesSha2,
            None,
            false,
        )
        .unwrap();
        client
            .olm_machine_for_testing()
            .await
            .as_ref()
            .unwrap()
            .store()
            .import_room_keys(vec![inbound.export().await], None, |_, _| ())
            .await
            .unwrap();
        outbound
    }

    async fn saved_login(
        server: &MatrixMockServer,
        data_dir: &std::path::Path,
    ) -> crate::session::PersistedAccount {
        let base = cold_push_store_dir(data_dir);
        let mut registry = crate::session::AccountRegistry::empty();
        let (account_id, store_id) = registry.allocate_account(base.to_str().unwrap());
        registry.upsert(crate::session::PersistedAccount {
            account_id,
            store_id,
            session: serde_json::from_value(json!({
                "homeserver": server.uri(), "resolved_homeserver": server.uri(),
                "credentials": {"kind": "password", "user_id": "@alice:example.org",
                    "device_id": "A", "access_token": "test-token"}
            }))
            .unwrap(),
            needs_reauth: false,
            device_invalidated: false,
        });
        FileSessionStore::new(&base)
            .save(serde_json::to_vec(&registry).unwrap())
            .await
            .unwrap();
        let account = registry.accounts.remove(0);
        let seeded = crate::session::restore_client(&account.store_id, &account.session, true)
            .await
            .unwrap();
        crate::session::restore_credentials(&seeded, &account.session)
            .await
            .unwrap();
        account
    }

    fn core_of(data_dir: &std::path::Path) -> std::sync::Arc<crate::Core> {
        let base = cold_push_store_dir(data_dir);
        crate::Core::new(
            base.to_str().unwrap(),
            Box::new(FileSessionStore::new(&base)),
        )
        .0
    }

    async fn waits_for(lease_holder: impl FnOnce(), store_id: &str) {
        let opening = tokio::spawn({
            let store_id = store_id.to_owned();
            async move { drop(crate::session::store_lease(&store_id).await) }
        });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert!(!opening.is_finished());
        lease_holder();
        tokio::time::timeout(std::time::Duration::from_secs(5), opening)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn a_push_decrypts_on_the_client_the_core_opens_for_its_login() {
        let data_dir = tempfile::tempdir().unwrap();
        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let account = saved_login(&server, data_dir.path()).await;
        let core = core_of(data_dir.path());
        let lease = crate::session::store_lease(&account.store_id).await;
        let client = core.saved_account_client(&account, &lease).await.unwrap();
        drop(lease);
        server
            .mock_sync()
            .ok_and_run(&client, |builder| {
                builder.add_joined_room(JoinedRoomBuilder::new(room_id!("!cold:example.org")));
            })
            .await;
        let outbound = shared_room_key(&client).await;
        let event = encrypted_push(
            &outbound,
            "m.room.message",
            json!({"msgtype":"m.text", "body":"Shared preview"}),
        )
        .await;
        let held = crate::session::base_client(&account.store_id).unwrap();

        let decrypted = decrypt_cold_push(
            data_dir.path(),
            "@alice:example.org",
            "A",
            COLD_ROOM,
            &event,
            true,
        )
        .await;

        assert!(matches!(decrypted, ColdPush::Clear(_)));
        assert!(std::sync::Arc::ptr_eq(
            &held,
            &crate::session::base_client(&account.store_id)
                .expect("the core's client still owns the store"),
        ));
    }

    #[tokio::test]
    async fn pusher_upkeep_uses_the_client_of_the_core_in_the_process() {
        let data_dir = tempfile::tempdir().unwrap();
        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let account = saved_login(&server, data_dir.path()).await;
        let core = core_of(data_dir.path());

        let upkeep = restore_push_client(
            &cold_push_store_dir(data_dir.path()),
            "@alice:example.org",
            "A",
        )
        .await
        .unwrap();

        assert!(
            core.account_clients
                .lock()
                .await
                .contains_key(&account.account_id)
        );
        assert!(crate::session::base_client(&account.store_id).is_some());
        drop(upkeep);
    }

    #[tokio::test]
    async fn a_core_waits_for_a_push_that_opened_the_store_before_it() {
        let data_dir = tempfile::tempdir().unwrap();
        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let account = saved_login(&server, data_dir.path()).await;
        let cold = restore_push_client(
            &cold_push_store_dir(data_dir.path()),
            "@alice:example.org",
            "A",
        )
        .await
        .unwrap();
        let _core = core_of(data_dir.path());

        waits_for(|| drop(cold), &account.store_id).await;
    }

    #[tokio::test]
    async fn the_core_cannot_activate_a_login_while_a_push_runs_on_its_client() {
        let data_dir = tempfile::tempdir().unwrap();
        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let account = saved_login(&server, data_dir.path()).await;
        let _core = core_of(data_dir.path());
        let host = push_host(
            &cold_push_store_dir(data_dir.path()),
            "@alice:example.org",
            "A",
        )
        .await;
        assert!(matches!(host, Some(PushHost::Shared { .. })));

        waits_for(|| drop(host), &account.store_id).await;
    }

    async fn encrypted_push(
        outbound: &OutboundGroupSession,
        event_type: &str,
        content: serde_json::Value,
    ) -> String {
        let content = outbound
            .encrypt(event_type, &serde_json::from_value(content).unwrap())
            .await
            .content;
        json!({"type":"m.room.encrypted", "event_id":"$cold",
            "sender":"@sender:example.org", "origin_server_ts":1, "content":content})
        .to_string()
    }

    fn cold_room_with_members() -> JoinedRoomBuilder {
        let factory = matrix_sdk_test::event_factory::EventFactory::new()
            .room(room_id!("!cold:example.org"))
            .sender(user_id!("@sender:example.org"));
        JoinedRoomBuilder::new(room_id!("!cold:example.org"))
            .add_state_event(factory.member(user_id!("@alice:example.org")))
            .add_state_event(factory.member(user_id!("@sender:example.org")))
            .add_state_event(factory.default_power_levels())
    }

    #[tokio::test]
    async fn a_cold_push_the_push_rules_silence_is_discarded() {
        use matrix_sdk::ruma::push::PredefinedUnderrideRuleId;

        let fixture = ColdFixture::new("reaction", cold_room_with_members(), None).await;
        let reaction = fixture
            .push(
                "m.reaction",
                json!({"m.relates_to": {"rel_type": "m.annotation", "event_id": "$target", "key": "👍"}}),
            )
            .await;
        let message = fixture
            .push(
                "m.room.message",
                json!({"msgtype":"m.text", "body":"hello"}),
            )
            .await;

        assert_eq!(fixture.decrypt("A", &reaction).await, ColdPush::Discard);
        assert!(matches!(
            fixture.decrypt("A", &message).await,
            ColdPush::Clear(_)
        ));
        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();

        let mut rules = Ruleset::server_default(user_id!("@alice:example.org"));
        rules
            .set_actions(
                RuleKind::Underride,
                PredefinedUnderrideRuleId::Message.as_str(),
                vec![],
            )
            .unwrap();
        let fixture = ColdFixture::new("mentions", cold_room_with_members(), Some(rules)).await;
        let message = fixture
            .push(
                "m.room.message",
                json!({"msgtype":"m.text", "body":"hello"}),
            )
            .await;

        assert_eq!(fixture.decrypt("A", &message).await, ColdPush::Discard);
        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();
    }

    #[tokio::test]
    async fn a_cold_push_in_an_all_messages_room_is_shown_under_a_mentions_default() {
        use matrix_sdk::ruma::push::{NewPushRule, NewSimplePushRule, PredefinedUnderrideRuleId};

        let mut rules = Ruleset::server_default(user_id!("@alice:example.org"));
        rules
            .set_actions(
                RuleKind::Underride,
                PredefinedUnderrideRuleId::Message.as_str(),
                vec![],
            )
            .unwrap();
        rules
            .insert(
                NewPushRule::Room(NewSimplePushRule::new(
                    room_id!("!cold:example.org").to_owned(),
                    vec![matrix_sdk::ruma::push::Action::Notify],
                )),
                None,
                None,
            )
            .unwrap();
        let fixture = ColdFixture::new("all", cold_room_with_members(), Some(rules)).await;
        let message = fixture
            .push(
                "m.room.message",
                json!({"msgtype":"m.text", "body":"hello"}),
            )
            .await;

        let ColdPush::Clear(clear) = fixture.decrypt("A", &message).await else {
            panic!("an all-messages room must still notify");
        };
        let clear = serde_json::from_str::<serde_json::Value>(&clear).unwrap();
        assert_eq!(clear["content"]["body"], "hello");
        assert_eq!(clear.get(super::NOISY_KEY), None);
        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();
    }

    #[tokio::test]
    async fn a_cold_push_whose_rule_rings_is_marked_noisy() {
        use matrix_sdk::ruma::push::{Action, NewPushRule, NewSimplePushRule, Tweak};

        let mut rules = Ruleset::server_default(user_id!("@alice:example.org"));
        rules
            .insert(
                NewPushRule::Room(NewSimplePushRule::new(
                    room_id!("!cold:example.org").to_owned(),
                    vec![
                        Action::Notify,
                        Action::SetTweak(Tweak::Sound("default".into())),
                    ],
                )),
                None,
                None,
            )
            .unwrap();
        let fixture = ColdFixture::new("noisy", cold_room_with_members(), Some(rules)).await;
        let message = fixture
            .push("m.room.message", json!({"msgtype":"m.text", "body":"ring"}))
            .await;

        let ColdPush::Clear(clear) = fixture.decrypt("A", &message).await else {
            panic!("a ringing room must notify");
        };
        let clear = serde_json::from_str::<serde_json::Value>(&clear).unwrap();
        assert_eq!(clear["content"]["body"], "ring");
        assert_eq!(clear[super::NOISY_KEY], true);
        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();
    }

    #[tokio::test]
    async fn a_local_decryption_asks_for_the_key_quietly_only_when_every_encrypted_event_is_pushed()
    {
        let stranger = OutboundGroupSession::new(
            owned_device_id!("STRANGER"),
            std::sync::Arc::new(Account::new(user_id!("@sender:example.org")).identity_keys()),
            room_id!("!cold:example.org"),
            EncryptionSettings::default(),
        )
        .unwrap();
        let unknown = encrypted_push(
            &stranger,
            "m.room.message",
            json!({"msgtype":"m.text", "body":"hello"}),
        )
        .await;

        let fixture = ColdFixture::new("needs-key", cold_room_with_members(), None).await;
        assert_eq!(
            fixture.decrypt_locally(&unknown).await,
            ColdPush::NeedsKey { quietly: false }
        );
        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();

        let mut rules = Ruleset::server_default(user_id!("@alice:example.org"));
        rules.override_.insert(
            serde_json::from_value::<ConditionalPushRule>(json!({
                "rule_id": ".org.matrix.msc4028.encrypted_event",
                "default": true,
                "enabled": true,
                "conditions": [{"kind": "event_match", "key": "type", "pattern": "m.room.encrypted"}],
                "actions": ["notify"],
            }))
            .unwrap(),
        );
        let fixture =
            ColdFixture::new("needs-key-quietly", cold_room_with_members(), Some(rules)).await;
        assert_eq!(
            fixture.decrypt_locally(&unknown).await,
            ColdPush::NeedsKey { quietly: true }
        );
        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();
    }

    async fn fetch(fixture: &ColdFixture, device: &str, event: serde_json::Value) -> PushFetchView {
        use matrix_sdk::ruma::api::client::sync::sync_events::v5;

        let mut room = v5::response::Room::new();
        room.initial = Some(true);
        room.timeline = vec![Raw::from_json_string(event.to_string()).unwrap()];
        let mut response = v5::Response::new("1".to_owned());
        response.rooms =
            std::collections::BTreeMap::from([(room_id!("!cold:example.org").to_owned(), room)]);
        let _sync = fixture
            .server
            .mock_sliding_sync()
            .ok(response)
            .mount_as_scoped()
            .await;
        let _encryption = fixture
            .server
            .mock_room_state_encryption()
            .plain()
            .mount_as_scoped()
            .await;
        fetch_cold_push_event(
            &fixture.data_dir,
            "@alice:example.org",
            device,
            COLD_ROOM,
            event["event_id"].as_str().unwrap(),
        )
        .await
    }

    #[tokio::test]
    async fn an_event_id_only_push_is_fetched_in_the_shape_of_a_rich_payload() {
        let fixture = ColdFixture::new("fetch", cold_room_with_members(), None).await;
        let message = json!({"type": "m.room.message", "event_id": "$fetched",
            "sender": "@sender:example.org", "origin_server_ts": 1,
            "content": {"msgtype": "m.text", "body": "fetched by id"}});

        let PushFetchView::Event { event } = fetch(&fixture, "A", message.clone()).await else {
            panic!("a push that names only its event must be fetched");
        };
        let payload = serde_json::to_value(&event).unwrap();
        assert_eq!(payload["type"], "m.room.message");
        assert_eq!(payload["content"]["body"], "fetched by id");
        assert_eq!(payload["sender"], "@sender:example.org");
        assert_ne!(event.room_name, "");

        assert!(matches!(
            fetch(&fixture, "OTHER", message).await,
            PushFetchView::Unavailable
        ));

        tokio::fs::remove_dir_all(&fixture.data_dir).await.unwrap();
    }

    #[tokio::test]
    async fn a_cold_push_saves_the_tokens_it_refreshes() {
        use wiremock::{
            Mock, ResponseTemplate,
            matchers::{header, method, path},
        };

        let data_dir =
            std::env::temp_dir().join(format!("sable-cold-push-refresh-{}", std::process::id()));
        let store_dir = cold_push_store_dir(&data_dir);
        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let persisted: PersistedSession = serde_json::from_value(json!({
            "homeserver": server.uri(), "resolved_homeserver": server.uri(),
            "credentials": {"kind": "password", "user_id": "@alice:example.org",
                "device_id": "A", "access_token": "old-access", "refresh_token": "old-refresh"}
        }))
        .unwrap();
        let seeded = crate::session::restore_client(store_dir.to_str().unwrap(), &persisted, true)
            .await
            .unwrap();
        crate::session::restore_credentials(&seeded, &persisted)
            .await
            .unwrap();
        drop(seeded);
        let store = FileSessionStore::new(&store_dir);
        store
            .save(serde_json::to_vec(&persisted).unwrap())
            .await
            .unwrap();
        Mock::given(method("POST"))
            .and(path("/_matrix/client/v3/refresh"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"access_token": "new-access", "refresh_token": "new-refresh"}),
            ))
            .expect(1)
            .mount(server.server())
            .await;

        let client = restore_push_client(&store_dir, "@alice:example.org", "A")
            .await
            .unwrap();
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/account/whoami"))
            .and(header("authorization", "Bearer old-access"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({
                "errcode": "M_UNKNOWN_TOKEN", "error": "expired"
            })))
            .mount(server.server())
            .await;
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/account/whoami"))
            .and(header("authorization", "Bearer new-access"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "user_id": "@alice:example.org", "device_id": "A"
            })))
            .mount(server.server())
            .await;
        client.retry(|| client.whoami()).await.unwrap();

        let saved = store.load().await.unwrap().unwrap();
        let (accounts, _) =
            crate::session::AccountRegistry::from_bytes(&saved, store_dir.to_str().unwrap())
                .unwrap();
        let session = serde_json::to_value(&accounts.accounts[0].session).unwrap();
        assert_eq!(session["credentials"]["refresh_token"], "new-refresh");
        assert!(
            FileSessionStore::try_exclusive(&store_dir)
                .unwrap()
                .is_none()
        );
        let lingering = client.client.clone();
        drop(client);
        assert!(
            FileSessionStore::try_exclusive(&store_dir)
                .unwrap()
                .is_some()
        );

        drop(lingering);
        tokio::fs::remove_dir_all(&data_dir).await.unwrap();
    }

    async fn seeded_cold_store(
        server: &MatrixMockServer,
        name: &str,
    ) -> (std::path::PathBuf, std::path::PathBuf, FileSessionStore) {
        let data_dir = std::env::temp_dir().join(format!("sable-{name}-{}", std::process::id()));
        let store_dir = cold_push_store_dir(&data_dir);
        let persisted: PersistedSession = serde_json::from_value(json!({
            "homeserver": server.uri(), "resolved_homeserver": server.uri(),
            "credentials": {"kind": "password", "user_id": "@alice:example.org",
                "device_id": "A", "access_token": "old-access", "refresh_token": "old-refresh"}
        }))
        .unwrap();
        let seeded = crate::session::restore_client(store_dir.to_str().unwrap(), &persisted, true)
            .await
            .unwrap();
        crate::session::restore_credentials(&seeded, &persisted)
            .await
            .unwrap();
        drop(seeded);
        let store = FileSessionStore::new(&store_dir);
        store
            .save(serde_json::to_vec(&persisted).unwrap())
            .await
            .unwrap();
        (data_dir, store_dir, store)
    }

    async fn saved_refresh_token(store: &FileSessionStore, store_dir: &std::path::Path) -> String {
        let saved = store.load().await.unwrap().unwrap();
        let (accounts, _) =
            crate::session::AccountRegistry::from_bytes(&saved, store_dir.to_str().unwrap())
                .unwrap();
        let session = serde_json::to_value(&accounts.accounts[0].session).unwrap();
        session["credentials"]["refresh_token"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_cold_push_cut_short_still_saves_the_rotated_tokens() {
        use wiremock::{
            Mock, ResponseTemplate,
            matchers::{header, method, path},
        };

        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let (data_dir, store_dir, store) = seeded_cold_store(&server, "cold-push-cut-short").await;
        Mock::given(method("POST"))
            .and(path("/_matrix/client/v3/refresh"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(
                        json!({"access_token": "new-access", "refresh_token": "new-refresh"}),
                    )
                    .set_delay(std::time::Duration::from_millis(1500)),
            )
            .expect(1)
            .mount(server.server())
            .await;
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/account/whoami"))
            .and(header("authorization", "Bearer old-access"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({
                "errcode": "M_UNKNOWN_TOKEN", "error": "expired"
            })))
            .mount(server.server())
            .await;

        let cold_dir = store_dir.clone();
        tokio::task::spawn_blocking(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(super::settle_refreshes(tokio::time::timeout(
                    std::time::Duration::from_millis(500),
                    async {
                        let client = restore_push_client(&cold_dir, "@alice:example.org", "A")
                            .await
                            .unwrap();
                        let _ = client.retry(|| client.whoami()).await;
                    },
                )))
                .unwrap_err();
        })
        .await
        .unwrap();

        assert_eq!(saved_refresh_token(&store, &store_dir).await, "new-refresh");
        tokio::fs::remove_dir_all(&data_dir).await.unwrap();
    }

    #[tokio::test]
    async fn a_cold_push_failure_with_a_live_token_does_not_rotate_it() {
        use wiremock::{
            Mock, ResponseTemplate,
            matchers::{method, path},
        };

        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let (data_dir, store_dir, store) = seeded_cold_store(&server, "cold-push-live-token").await;
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/account/whoami"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "user_id": "@alice:example.org", "device_id": "A"
            })))
            .mount(server.server())
            .await;
        Mock::given(method("POST"))
            .and(path("/_matrix/client/v3/refresh"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"access_token": "new-access", "refresh_token": "new-refresh"}),
            ))
            .expect(0)
            .mount(server.server())
            .await;

        let client = restore_push_client(&store_dir, "@alice:example.org", "A")
            .await
            .unwrap();
        client
            .retry(|| async { Err::<(), _>("the room key has not arrived") })
            .await
            .unwrap_err();

        assert_eq!(saved_refresh_token(&store, &store_dir).await, "old-refresh");
        drop(client);
        tokio::fs::remove_dir_all(&data_dir).await.unwrap();
    }

    #[tokio::test]
    async fn a_cold_client_does_not_refresh_while_the_foreground_owns_credentials() {
        use wiremock::{
            Mock, ResponseTemplate,
            matchers::{method, path},
        };
        let dir = tempfile::tempdir().unwrap();
        let server = MatrixMockServer::new().await;
        server.mock_versions().ok().mount().await;
        let store = FileSessionStore::exclusive(dir.path()).unwrap();
        let persisted: PersistedSession = serde_json::from_value(json!({
            "homeserver": server.uri(), "resolved_homeserver": server.uri(),
            "credentials": {"kind": "password", "user_id": "@alice:example.org",
                "device_id": "A", "access_token": "old-access", "refresh_token": "old-refresh"}
        }))
        .unwrap();
        let seeded = crate::session::restore_client(dir.path().to_str().unwrap(), &persisted, true)
            .await
            .unwrap();
        crate::session::restore_credentials(&seeded, &persisted)
            .await
            .unwrap();
        drop(seeded);
        let bytes = serde_json::to_vec(&persisted).unwrap();
        store.save(bytes.clone()).await.unwrap();
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/account/whoami"))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_json(json!({"errcode": "M_UNKNOWN_TOKEN", "error": "expired"})),
            )
            .mount(server.server())
            .await;
        Mock::given(method("POST"))
            .and(path("/_matrix/client/v3/refresh"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "new", "refresh_token": "new"})),
            )
            .expect(0)
            .mount(server.server())
            .await;
        let client = restore_push_client(dir.path(), "@alice:example.org", "A")
            .await
            .unwrap();
        client.retry(|| client.whoami()).await.unwrap_err();
        assert_eq!(store.load().await.unwrap(), Some(bytes));
    }

    fn stub(event_type: &str, content: &serde_json::Value) -> serde_json::Value {
        json!({
            "type": event_type,
            "content": content,
            "event_id": "$1:example.org",
            "sender": "@alice:example.org",
            "origin_server_ts": 0,
        })
    }

    #[test]
    fn every_notifiable_event_says_something() {
        let cases = [
            stub(
                "m.room.message",
                &json!({"msgtype": "m.text", "body": "hello"}),
            ),
            stub(
                "m.room.message",
                &json!({"msgtype": "m.image", "body": "cat.png", "url": "mxc://example.org/2"}),
            ),
            stub(
                "m.room.message",
                &json!({"msgtype": "dm.filament.gallery", "body": "", "itemtypes": [{"itemtype": "m.image", "body": "cat.png", "url": "mxc://example.org/3"}]}),
            ),
            stub(
                "m.room.encrypted",
                &json!({"algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x", "sender_key": "k", "device_id": "D", "session_id": "s"}),
            ),
            stub(
                "m.sticker",
                &json!({"body": "wave", "url": "mxc://example.org/1", "info": {"w": 1, "h": 1, "mimetype": "image/png", "size": 1}}),
            ),
            stub(
                "m.reaction",
                &json!({"m.relates_to": {"rel_type": "m.annotation", "event_id": "$0:example.org", "key": "👍"}}),
            ),
            stub(
                "org.matrix.msc3381.poll.start",
                &json!({"org.matrix.msc3381.poll.start": {"question": {"org.matrix.msc1767.text": "Lunch?"}, "answers": [{"id": "a", "org.matrix.msc1767.text": "Yes"}]}}),
            ),
            stub("m.room.topic", &json!({"topic": "hi"})),
        ];

        for case in cases {
            let body = describe(&event(&case));
            assert!(
                !body.is_empty(),
                "a notification for {case} would read as a bare sender name"
            );
        }
    }

    #[test]
    fn a_replayed_event_is_backfill_and_a_recent_one_is_not() {
        let now = ts(120_000);
        assert!(is_backfill(now, ts(1_000)));
        assert!(!is_backfill(now, ts(120_000)));
        assert!(!is_backfill(now, ts(200_000)));
        assert!(!is_backfill(now, ts(61_000)));
        assert!(is_backfill(now, ts(59_000)));
    }

    #[test]
    fn a_gateway_must_be_an_https_notify_endpoint() {
        assert_eq!(
            gateway("https://sygnal.example/_matrix/push/v1/notify").unwrap(),
            "https://sygnal.example/_matrix/push/v1/notify"
        );

        let accepted: Vec<&str> = [
            "http://sygnal.example/_matrix/push/v1/notify",
            "https://user:pass@sygnal.example/_matrix/push/v1/notify",
            "https://sygnal.example/_matrix/push/v1/notify#fragment",
            "https://sygnal.example/",
            "not a url",
        ]
        .into_iter()
        .filter(|address| gateway(address).is_ok())
        .collect();

        assert!(accepted.is_empty(), "these are not gateways: {accepted:?}");
    }
}
