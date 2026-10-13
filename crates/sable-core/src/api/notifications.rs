use std::sync::Arc;
use std::sync::atomic::Ordering;

use matrix_sdk::ruma::{OwnedEventId, OwnedRoomId};
use matrix_sdk_ui::notification_client::NotificationProcessSetup;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::protocol::{
    CommandErr, DefaultNotificationModesView, EventNotificationView, EventNotificationsView,
    InboxFilter, InboxItemView, KeywordNotificationView, MentionNotificationModeView,
    MentionNotificationsView, MentionRuleView, NotificationModeView, NotificationSettingsView,
    NotificationView, PushFetchView,
};
use crate::{Core, ResultExt, notifications, push_rules};

domain! {
    notification_settings => NotificationSettingsParams,
    default_notification_modes => DefaultNotificationModesParams,
    mention_notifications => MentionNotificationsParams,
    event_notifications => EventNotificationsParams,
    master_mute => MasterMuteParams,
    notification => NotificationParams,
    push_event => PushEventParams,
    notification_keywords => NotificationKeywordsParams,
    add_notification_keyword => AddNotificationKeywordParams,
    remove_notification_keyword => RemoveNotificationKeywordParams,
    set_notification_keyword_mode => SetNotificationKeywordModeParams,
    set_room_notification_mode => SetRoomNotificationModeParams,
    set_default_notification_mode => SetDefaultNotificationModeParams,
    set_mention_notifications => SetMentionNotificationsParams,
    set_event_notification => SetEventNotificationParams,
    set_master_mute => SetMasterMuteParams,
    inbox_notifications => InboxNotificationsParams,
    backfill_inbox => BackfillInboxParams,
    set_notification_content => SetNotificationContentParams,
    set_notification_sounds => SetNotificationSoundsParams,
    set_notify_once => SetNotifyOnceParams,
    set_notifications_enabled => SetNotificationsEnabledParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct NotificationSettingsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for NotificationSettingsParams {
    type Ok = NotificationSettingsView;

    async fn run(self, core: &Arc<Core>) -> Result<NotificationSettingsView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<DefaultNotificationModesView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<MentionNotificationsView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<EventNotificationsView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<Option<bool>, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<Option<NotificationView>, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<PushFetchView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<Vec<KeywordNotificationView>, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<InboxNotificationsOk, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<BackfillInboxOk, CommandErr> {
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

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), CommandErr>> {
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

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), CommandErr>> {
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

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), CommandErr>> {
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

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), CommandErr>> {
        core.notifications_enabled
            .store(self.enabled, Ordering::Relaxed);

        std::future::ready(Ok(()))
    }
}
