use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::Core;
use crate::protocol::RpcError;

domain! {
    widget_send_delayed_event,
    widget_send_sticky_event,
    restart_delayed_event,
    widget_send_to_device,
    room_sticky_events,
    set_widget_feed,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct WidgetSendDelayedEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
    #[serde(default)]
    pub state_key: Option<String>,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub content: serde_json::Value,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Number))]
    pub delay_ms: u64,
    #[serde(default)]
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub sticky_duration_ms: Option<u32>,
}

impl Handler for WidgetSendDelayedEventParams {
    /// The delay id.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, RpcError> {
        core.widget_send_delayed_event(
            &self.room_id,
            &self.event_type,
            self.state_key,
            self.content,
            self.delay_ms,
            self.sticky_duration_ms,
        )
        .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct WidgetSendStickyEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub content: serde_json::Value,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Number))]
    pub sticky_duration_ms: u32,
}

impl Handler for WidgetSendStickyEventParams {
    /// The event id.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, RpcError> {
        core.widget_send_sticky_event(
            &self.room_id,
            &self.event_type,
            self.content,
            self.sticky_duration_ms,
        )
        .await
        .map(|event_id| event_id.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RestartDelayedEventParams {
    pub delay_id: String,
}

impl Handler for RestartDelayedEventParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.restart_delayed_event(self.delay_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct WidgetSendToDeviceParams {
    pub event_type: String,
    pub encrypted: bool,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub messages: serde_json::Value,
}

impl Handler for WidgetSendToDeviceParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.widget_send_to_device(&self.event_type, self.encrypted, self.messages)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomStickyEventsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

/// The room's live sticky events, as raw JSON.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct StickyEvents(
    #[cfg_attr(feature = "typegen", specta(type = Vec<specta_typescript::Unknown>))]
    pub  Vec<serde_json::Value>,
);

impl Handler for RoomStickyEventsParams {
    type Ok = StickyEvents;

    async fn run(self, core: &Arc<Core>) -> Result<StickyEvents, RpcError> {
        core.room_sticky_events(&self.room_id)
            .await
            .map(StickyEvents)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetWidgetFeedParams {
    pub enabled: bool,
}

impl Handler for SetWidgetFeedParams {
    type Ok = ();

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), RpcError>> {
        core.set_widget_feed(self.enabled);
        std::future::ready(Ok(()))
    }
}
