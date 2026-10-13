use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::Core;
use crate::protocol::{
    CallBackendView, CallCompatibilityView, CallIntent, CallMode, CallModeReason, CallSessionId,
    CallSupportView, CommandErr, RtcLivekitEndpoint, TurnServerView,
};

domain! {
    turn_server => TurnServerParams,
    rtc_transports => RtcTransportsParams,
    rtc_livekit => RtcLivekitParams,
    join_call => JoinCallParams,
    call_compatibility => CallCompatibilityParams,
    call_support => CallSupportParams,
    leave_call => LeaveCallParams,
    set_call_screen_sharing => SetCallScreenSharingParams,
    decline_call => DeclineCallParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct TurnServerParams {}

impl Handler for TurnServerParams {
    type Ok = TurnServerView;

    async fn run(self, core: &Arc<Core>) -> Result<TurnServerView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<RtcBody, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<RtcBody, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<JoinCallOk, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<CallCompatibilityView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<CallSupportView, CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
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

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.decline_call(self.room_id, self.notification_event_id)
            .await
    }
}
