use std::sync::Arc;
use std::sync::atomic::Ordering;

use matrix_sdk::ruma::{OwnedEventId, OwnedRoomId};
use matrix_sdk_ui::notification_client::NotificationProcessSetup;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::protocol::{RpcError, DefaultNotificationModesView, EventNotificationView, EventNotificationsView, InboxItemView, KeywordNotificationView, MentionNotificationModeView, MentionNotificationsView, MentionRuleView, NotificationModeView, NotificationSettingsView, NotificationView, PushFetchView};
use crate::{Core, ResultExt, notifications, push_rules};

domain! {
    notification_settings,
    default_notification_modes,
    mention_notifications,
    event_notifications,
    master_mute,
    notification,
    push_event,
    notification_keywords,
    add_notification_keyword,
    remove_notification_keyword,
    set_notification_keyword_mode,
    set_room_notification_mode,
    set_default_notification_mode,
    set_mention_notifications,
    set_event_notification,
    set_master_mute,
    inbox_notifications,
    backfill_inbox,
    set_notification_content,
    set_notification_sounds,
    set_notify_once,
    set_notifications_enabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum InboxFilter {
    All,
    Mentions,
    Direct,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct NotificationSettingsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for NotificationSettingsParams {
    type Ok = NotificationSettingsView;

    async fn run(self, core: &Arc<Core>) -> Result<NotificationSettingsView, RpcError> {
        let room = core.room(&self.room_id).await?;
        let rules = core.push_rules().await?.snapshot().await;

        Ok(push_rules::room_settings(
            &rules,
            &self.room_id,
            notifications::uses_direct_push_rules(&room),
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DefaultNotificationModesParams {}

impl Handler for DefaultNotificationModesParams {
    type Ok = DefaultNotificationModesView;

    async fn run(self, core: &Arc<Core>) -> Result<DefaultNotificationModesView, RpcError> {
        Ok(push_rules::default_modes(
            &core.push_rules().await?.snapshot().await,
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct MentionNotificationsParams {}

impl Handler for MentionNotificationsParams {
    type Ok = MentionNotificationsView;

    async fn run(self, core: &Arc<Core>) -> Result<MentionNotificationsView, RpcError> {
        Ok(push_rules::mention_notifications(
            &core.push_rules().await?.snapshot().await,
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EventNotificationsParams {}

impl Handler for EventNotificationsParams {
    type Ok = EventNotificationsView;

    async fn run(self, core: &Arc<Core>) -> Result<EventNotificationsView, RpcError> {
        Ok(push_rules::event_notifications(
            &core.push_rules().await?.snapshot().await,
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct MasterMuteParams {}

impl Handler for MasterMuteParams {
    type Ok = Option<bool>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<bool>, RpcError> {
        Ok(push_rules::master_muted(
            &core.push_rules().await?.snapshot().await,
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct NotificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub event_id: OwnedEventId,
}

impl Handler for NotificationParams {
    /// `null` when the event notifies nobody, or is gone, or cannot be read.
    type Ok = Option<NotificationView>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<NotificationView>, RpcError> {
        let client = core.client().await?;
        let setup = NotificationProcessSetup::SingleProcess {
            sync_service: core.sync_service().await?,
        };

        Ok(notifications::notification(&client, setup, &self.room_id, &self.event_id).await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PushEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub event_id: OwnedEventId,
}

impl Handler for PushEventParams {
    type Ok = PushFetchView;

    async fn run(self, core: &Arc<Core>) -> Result<PushFetchView, RpcError> {
        let client = core.client().await?;
        let sync_service = core.sync_service().await?;

        Ok(Box::pin(notifications::fetch_push_event(
            &client,
            sync_service,
            &self.room_id,
            &self.event_id,
        ))
        .await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct NotificationKeywordsParams {}

impl Handler for NotificationKeywordsParams {
    type Ok = Vec<KeywordNotificationView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<KeywordNotificationView>, RpcError> {
        Ok(push_rules::keywords(
            &core.push_rules().await?.snapshot().await,
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AddNotificationKeywordParams {
    pub keyword: String,
}

impl Handler for AddNotificationKeywordParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let rules = core.push_rules().await?;
        let writes = push_rules::plan_add_keyword(&rules.snapshot().await, &self.keyword)
            .or_failed(core, "add_notification_keyword")?;
        rules
            .apply(writes)
            .await
            .or_failed(core, "add_notification_keyword")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemoveNotificationKeywordParams {
    pub keyword: String,
}

impl Handler for RemoveNotificationKeywordParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let rules = core.push_rules().await?;
        rules
            .apply(push_rules::plan_remove_keyword(
                &rules.snapshot().await,
                &self.keyword,
            ))
            .await
            .or_failed(core, "remove_notification_keyword")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetNotificationKeywordModeParams {
    pub keyword: String,
    pub mode: MentionNotificationModeView,
}

impl Handler for SetNotificationKeywordModeParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let rules = core.push_rules().await?;
        rules
            .apply(push_rules::plan_keyword_mode(
                &rules.snapshot().await,
                &self.keyword,
                self.mode,
            ))
            .await
            .or_failed(core, "set_notification_keyword_mode")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomNotificationModeParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    /// `null` drops the room's own rules so it follows the default again.
    pub mode: Option<NotificationModeView>,
}

impl Handler for SetRoomNotificationModeParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let room = core.room(&self.room_id).await?;
        let rules = core.push_rules().await?;
        let direct = notifications::uses_direct_push_rules(&room);
        let writes =
            push_rules::plan_room_mode(&rules.snapshot().await, &self.room_id, direct, self.mode);
        rules
            .apply(writes)
            .await
            .or_failed(core, "set_room_notification_mode")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetDefaultNotificationModeParams {
    pub direct: bool,
    pub mode: NotificationModeView,
}

impl Handler for SetDefaultNotificationModeParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let rules = core.push_rules().await?;
        let before = rules.snapshot().await;
        let writes = push_rules::plan_default_mode(&before, self.direct, self.mode)
            .or_failed(core, "set_default_notification_mode")?;
        rules
            .apply(writes)
            .await
            .or_failed(core, "set_default_notification_mode")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetMentionNotificationsParams {
    pub rule: MentionRuleView,
    pub mode: MentionNotificationModeView,
}

impl Handler for SetMentionNotificationsParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let rules = core.push_rules().await?;
        let writes = push_rules::plan_mention(&rules.snapshot().await, self.rule, self.mode)
            .or_failed(core, "set_mention_notifications")?;
        rules
            .apply(writes)
            .await
            .or_failed(core, "set_mention_notifications")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetEventNotificationParams {
    pub event: EventNotificationView,
    pub enabled: bool,
}

impl Handler for SetEventNotificationParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let rules = core.push_rules().await?;
        let writes = push_rules::plan_event(&rules.snapshot().await, self.event, self.enabled)
            .or_failed(core, "set_event_notification")?;
        rules
            .apply(writes)
            .await
            .or_failed(core, "set_event_notification")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetMasterMuteParams {
    pub muted: bool,
}

impl Handler for SetMasterMuteParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.push_rules()
            .await?
            .apply(push_rules::plan_master(self.muted))
            .await
            .or_failed(core, "set_master_mute")?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct InboxNotificationsParams {
    pub filter: InboxFilter,
    pub include_read: bool,
    pub limit: u32,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub before_ts: Option<u64>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct InboxNotificationsOk {
    pub items: Vec<InboxItemView>,
    pub has_more: bool,
}

impl Handler for InboxNotificationsParams {
    type Ok = InboxNotificationsOk;

    async fn run(self, core: &Arc<Core>) -> Result<InboxNotificationsOk, RpcError> {
        let (items, has_more) = core
            .inbox_notifications(self.filter, self.include_read, self.limit, self.before_ts)
            .await?;
        Ok(InboxNotificationsOk { items, has_more })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct BackfillInboxParams {
    pub include_read: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct BackfillInboxOk {
    pub recorded: u32,
    pub has_more: bool,
}

impl Handler for BackfillInboxParams {
    type Ok = BackfillInboxOk;

    async fn run(self, core: &Arc<Core>) -> Result<BackfillInboxOk, RpcError> {
        let (recorded, has_more) = core.backfill_inbox(self.include_read).await?;
        Ok(BackfillInboxOk { recorded, has_more })
    }
}

/// Mirrors the reader's choice so a native shell can apply it too.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetNotificationContentParams {
    pub visible: bool,
    pub encrypted: bool,
}

impl Handler for SetNotificationContentParams {
    type Ok = ();

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), RpcError>> {
        core.notification_content
            .store(self.visible, Ordering::Relaxed);
        core.notification_encrypted_content
            .store(self.encrypted, Ordering::Relaxed);

        std::future::ready(Ok(()))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetNotificationSoundsParams {
    pub enabled: bool,
}

impl Handler for SetNotificationSoundsParams {
    type Ok = ();

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), RpcError>> {
        core.notification_sounds
            .store(self.enabled, Ordering::Relaxed);

        std::future::ready(Ok(()))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetNotifyOnceParams {
    pub enabled: bool,
}

impl Handler for SetNotifyOnceParams {
    type Ok = ();

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), RpcError>> {
        core.notify_once.store(self.enabled, Ordering::Relaxed);

        std::future::ready(Ok(()))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetNotificationsEnabledParams {
    pub enabled: bool,
}

impl Handler for SetNotificationsEnabledParams {
    type Ok = ();

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), RpcError>> {
        core.notifications_enabled
            .store(self.enabled, Ordering::Relaxed);

        std::future::ready(Ok(()))
    }
}
