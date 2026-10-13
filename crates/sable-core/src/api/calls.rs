use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::Core;
use crate::protocol::{CallBackendView, CallCompatibilityView, CallIntent, CallMode, CallModeReason, CallSessionId, CallSupportView, RpcError, TurnServerView};

domain! {
    turn_server,
    rtc_transports,
    rtc_livekit,
    join_call,
    call_compatibility,
    call_support,
    leave_call,
    set_call_screen_sharing,
    decline_call,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum RtcLivekitEndpoint {
    GetToken,
    DelegateDelayedLeave,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct TurnServerParams {}

impl Handler for TurnServerParams {
    type Ok = TurnServerView;

    async fn run(self, core: &Arc<Core>) -> Result<TurnServerView, RpcError> {
        core.turn_server().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RtcTransportsParams {}

/// The homeserver's response body, relayed as is.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct RtcBody(
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub  serde_json::Value,
);

impl Handler for RtcTransportsParams {
    type Ok = RtcBody;

    async fn run(self, core: &Arc<Core>) -> Result<RtcBody, RpcError> {
        core.rtc_transports().await.map(RtcBody)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RtcLivekitParams {
    pub endpoint: RtcLivekitEndpoint,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub body: serde_json::Value,
}

impl Handler for RtcLivekitParams {
    type Ok = RtcBody;

    async fn run(self, core: &Arc<Core>) -> Result<RtcBody, RpcError> {
        core.rtc_livekit(self.endpoint, &self.body).await.map(RtcBody)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct JoinCallParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub livekit_service_url: Option<String>,
    #[serde(default)]
    pub mode: Option<CallMode>,
    #[serde(default)]
    pub intent: Option<CallIntent>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct JoinCallOk {
    pub session: CallSessionId,
    pub url: String,
    pub jwt: String,
    pub identity: String,
    pub encrypt_media: bool,
    pub mode: CallMode,
    pub mode_reason: CallModeReason,
    pub sticky_available: bool,
    pub peer_modes: Vec<CallMode>,
    pub can_publish: bool,
    pub publisher_id: String,
    pub backends: Vec<CallBackendView>,
}

impl Handler for JoinCallParams {
    type Ok = JoinCallOk;

    async fn run(self, core: &Arc<Core>) -> Result<JoinCallOk, RpcError> {
        core.join_call(
            self.room_id,
            self.livekit_service_url,
            self.mode,
            self.intent,
        )
        .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CallCompatibilityParams {}

impl Handler for CallCompatibilityParams {
    type Ok = CallCompatibilityView;

    async fn run(self, core: &Arc<Core>) -> Result<CallCompatibilityView, RpcError> {
        core.call_compatibility().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CallSupportParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[serde(default)]
    pub livekit_service_url: Option<String>,
}

impl Handler for CallSupportParams {
    type Ok = CallSupportView;

    async fn run(self, core: &Arc<Core>) -> Result<CallSupportView, RpcError> {
        core.call_support(self.room_id, self.livekit_service_url)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct LeaveCallParams {
    pub session: CallSessionId,
}

impl Handler for LeaveCallParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.leave_call(self.session).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetCallScreenSharingParams {
    pub session: CallSessionId,
    pub active: bool,
}

impl Handler for SetCallScreenSharingParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_call_screen_sharing(self.session, self.active)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DeclineCallParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub notification_event_id: String,
}

impl Handler for DeclineCallParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.decline_call(self.room_id, self.notification_event_id)
            .await
    }
}
