use std::time::Duration;

use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    plugin::{mobile::PluginInvokeError, PluginApi, PluginHandle},
    AppHandle, Runtime,
};
use tokio::sync::mpsc;

use crate::{
    error::Error,
    models::{
        failure_code_from_raw, ClearNativeCallLocalVideoOverlayRequest,
        ClearNativeCallRemoteVideoOverlayRequest, CommandWithSnapshotResponse,
        DisconnectNativeCallRequest, EndSystemCallRequest, FulfillAnswerCallRequest,
        FulfillEndCallRequest, GetAudioRoutesRequest, GetAudioRoutesResponse,
        NativeCallCapabilities, NativeCallCapabilitiesWire, NativeCallChannelEvent,
        NativeCallFailureCode, NativeCallSnapshot, NativeConnectCallFields, ReportConnectedRequest,
        ReportIncomingCallRequest, SetAudioInputRequest, SetAudioRouteRequest, SetNativeCallAudioProcessingRequest,
        SetNativeCallCameraEnabledRequest, SetNativeCallEncryptionKeyRequest,
        SetNativeCallLocalVideoOverlayRequest, SetNativeCallMicrophoneEnabledRequest,
        SetNativeCallParticipantVolumeRequest, SetNativeCallPiPEnabledRequest,
        SetNativeCallRemoteVideoOverlayRequest, SetNativeCallScreenShareEnabledRequest,
        SetSystemCallMutedRequest, StartSystemCallRequest, SwitchNativeCallCameraRequest,
        SystemCallAction, UpdateCallDisplayRequest,
    },
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.livekit_mobile";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_livekit_mobile);

#[cfg(target_os = "ios")]
#[derive(serde::Deserialize)]
struct VoipTokenWire {
    #[serde(default)]
    token: Option<String>,
}

#[cfg(target_os = "android")]
mod platform_commands {
    pub(super) const CAPABILITIES: &str = "getNativeCallCapabilities";
    pub(super) const CONNECT: &str = "connectNativeCall";
    pub(super) const DISCONNECT: &str = "disconnectNativeCall";
    pub(super) const SET_MICROPHONE_ENABLED: &str = "setNativeCallMicrophoneEnabled";
    pub(super) const SET_CAMERA_ENABLED: &str = "setNativeCallCameraEnabled";
    pub(super) const SET_AUDIO_PROCESSING: &str = "setNativeCallAudioProcessing";
    pub(super) const SET_PARTICIPANT_VOLUME: &str = "setNativeCallParticipantVolume";
    pub(super) const SET_SCREEN_SHARE_ENABLED: &str = "setNativeCallScreenShareEnabled";
    pub(super) const SET_PIP_ENABLED: &str = "setNativeCallPiPEnabled";
    pub(super) const SWITCH_CAMERA: &str = "switchNativeCallCamera";
    pub(super) const CANCEL_CONNECT: &str = "cancelNativeCallConnect";
    pub(super) const GET_STATE: &str = "getNativeCallState";
    pub(super) const SET_REMOTE_VIDEO_OVERLAY: &str = "setNativeCallRemoteVideoOverlay";
    pub(super) const CLEAR_REMOTE_VIDEO_OVERLAY: &str = "clearNativeCallRemoteVideoOverlay";
    pub(super) const SET_LOCAL_VIDEO_OVERLAY: &str = "setNativeCallLocalVideoOverlay";
    pub(super) const CLEAR_LOCAL_VIDEO_OVERLAY: &str = "clearNativeCallLocalVideoOverlay";
    pub(super) const START_SYSTEM_CALL: &str = "startSystemCall";
    pub(super) const REPORT_INCOMING_CALL: &str = "reportIncomingCall";
    pub(super) const END_SYSTEM_CALL: &str = "endSystemCall";
    pub(super) const SET_SYSTEM_CALL_MUTED: &str = "setSystemCallMuted";
    pub(super) const DRAIN_PENDING_ACTIONS: &str = "drainPendingSystemCallActions";
    pub(super) const FULFILL_ANSWER_CALL: &str = "fulfillAnswerCall";
    pub(super) const FULFILL_END_CALL: &str = "fulfillEndCall";
    pub(super) const REPORT_CONNECTED: &str = "reportSystemCallConnected";
    pub(super) const SET_ENCRYPTION_KEY: &str = "setNativeCallEncryptionKey";
    pub(super) const GET_AUDIO_ROUTES: &str = "getAudioRoutes";
    pub(super) const SET_AUDIO_ROUTE: &str = "setAudioRoute";
    pub(super) const SET_AUDIO_INPUT: &str = "setAudioInput";
    pub(super) const UPDATE_CALL_DISPLAY: &str = "updateCallDisplay";
}
#[cfg(target_os = "ios")]
mod platform_commands {
    pub(super) const CAPABILITIES: &str = "capabilities";
    pub(super) const CONNECT: &str = "connect";
    pub(super) const DISCONNECT: &str = "disconnect";
    pub(super) const SET_MICROPHONE_ENABLED: &str = "setMicrophoneEnabled";
    pub(super) const SET_CAMERA_ENABLED: &str = "setCameraEnabled";
    pub(super) const SET_AUDIO_PROCESSING: &str = "setAudioProcessing";
    pub(super) const SET_PARTICIPANT_VOLUME: &str = "setParticipantVolume";
    pub(super) const SET_SCREEN_SHARE_ENABLED: &str = "setScreenShareEnabled";
    pub(super) const SET_PIP_ENABLED: &str = "setNativeCallPiPEnabled";
    pub(super) const SWITCH_CAMERA: &str = "switchCamera";
    pub(super) const CANCEL_CONNECT: &str = "cancelConnect";
    pub(super) const GET_STATE: &str = "getState";
    pub(super) const SET_REMOTE_VIDEO_OVERLAY: &str = "setRemoteVideoOverlay";
    pub(super) const CLEAR_REMOTE_VIDEO_OVERLAY: &str = "clearRemoteVideoOverlay";
    pub(super) const SET_LOCAL_VIDEO_OVERLAY: &str = "setLocalVideoOverlay";
    pub(super) const CLEAR_LOCAL_VIDEO_OVERLAY: &str = "clearLocalVideoOverlay";
    pub(super) const START_SYSTEM_CALL: &str = "startSystemCall";
    pub(super) const REPORT_INCOMING_CALL: &str = "reportIncomingCall";
    pub(super) const END_SYSTEM_CALL: &str = "endSystemCall";
    pub(super) const SET_SYSTEM_CALL_MUTED: &str = "setSystemCallMuted";
    pub(super) const DRAIN_PENDING_ACTIONS: &str = "drainPendingSystemCallActions";
    pub(super) const GET_VOIP_TOKEN: &str = "getVoipToken";
    pub(super) const FULFILL_ANSWER_CALL: &str = "fulfillAnswerCall";
    pub(super) const FULFILL_END_CALL: &str = "fulfillEndCall";
    pub(super) const REPORT_CONNECTED: &str = "reportConnected";
    pub(super) const SET_ENCRYPTION_KEY: &str = "setEncryptionKey";
    pub(super) const GET_AUDIO_ROUTES: &str = "getAudioRoutes";
    pub(super) const SET_AUDIO_ROUTE: &str = "setAudioRoute";
    pub(super) const SET_AUDIO_INPUT: &str = "setAudioInput";
    pub(super) const UPDATE_CALL_DISPLAY: &str = "updateCallDisplay";
}

/// Upper bound for any single native invocation, so a hung native call
/// cannot wedge the bridge actor. Connect gets a wider bound: the native
/// side may surface a microphone permission prompt before the room joins.
const NATIVE_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const NATIVE_CONNECT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub(crate) struct MobileBackend<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> MobileBackend<R> {
    pub(crate) fn new(handle: PluginHandle<R>) -> Self {
        Self { handle }
    }

    /// Builds the connect channel: valid snapshot events are handed straight
    /// to the actor's unbounded internal queue; anything else is dropped.
    pub(crate) fn native_call_event_channel(
        sender: mpsc::UnboundedSender<NativeCallChannelEvent>,
    ) -> Channel<NativeCallChannelEvent> {
        Channel::new(move |body: InvokeResponseBody| {
            if let Ok(event) = body.deserialize::<NativeCallChannelEvent>() {
                let _ = sender.send(event);
            }
            Ok(())
        })
    }

    /// Runs a native command with a time bound. A native rejection is
    /// sanitized into the bounded failure vocabulary; an elapsed bound is the
    /// bridge-level [`Error::Timeout`].
    async fn invoke_with_timeout<T: DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
        timeout: Duration,
    ) -> crate::Result<T> {
        match tokio::time::timeout(
            timeout,
            self.handle.run_mobile_plugin_async::<T>(command, payload),
        )
        .await
        {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(PluginInvokeError::InvokeRejected(rejection))) => Err(Error::failure(
                failure_code_from_raw(rejection.code.as_deref()),
            )),
            Ok(Err(_)) => Err(Error::failure(NativeCallFailureCode::Unexpected)),
            Err(_) => Err(Error::Timeout),
        }
    }

    async fn invoke<T: DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> crate::Result<T> {
        self.invoke_with_timeout(command, payload, NATIVE_CALL_TIMEOUT)
            .await
    }

    async fn invoke_for_acknowledgement(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> crate::Result<()> {
        self.invoke::<serde::de::IgnoredAny>(command, payload)
            .await
            .map(|_| ())
    }

    /// Unwraps the `receiver` key the CallKit commands wrap their snapshot in.
    async fn invoke_for_snapshot(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> crate::Result<NativeCallSnapshot> {
        let response: CommandWithSnapshotResponse = self.invoke(command, payload).await?;
        Ok(response.receiver)
    }

    pub(crate) async fn get_native_call_capabilities(
        &self,
    ) -> crate::Result<NativeCallCapabilities> {
        let native: NativeCallCapabilitiesWire =
            self.invoke(platform_commands::CAPABILITIES, ()).await?;
        Ok(native.into())
    }

    pub(crate) async fn connect_native_call(
        &self,
        request: NativeConnectCallRequest<'_>,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke_with_timeout(platform_commands::CONNECT, request, NATIVE_CONNECT_TIMEOUT)
            .await
    }

    pub(crate) async fn disconnect_native_call(
        &self,
        request: DisconnectNativeCallRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::DISCONNECT, request).await
    }

    pub(crate) async fn cancel_native_call_connect(
        &self,
        request: DisconnectNativeCallRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::CANCEL_CONNECT, request)
            .await
    }

    pub(crate) async fn set_native_call_microphone_enabled(
        &self,
        request: SetNativeCallMicrophoneEnabledRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_MICROPHONE_ENABLED, request)
            .await
    }

    pub(crate) async fn set_native_call_audio_processing(
        &self,
        request: SetNativeCallAudioProcessingRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_AUDIO_PROCESSING, request)
            .await
    }

    pub(crate) async fn set_native_call_participant_volume(
        &self,
        request: SetNativeCallParticipantVolumeRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_PARTICIPANT_VOLUME, request)
            .await
    }

    pub(crate) async fn set_native_call_camera_enabled(
        &self,
        request: SetNativeCallCameraEnabledRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_CAMERA_ENABLED, request)
            .await
    }

    pub(crate) async fn set_native_call_screen_share_enabled(
        &self,
        request: SetNativeCallScreenShareEnabledRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_SCREEN_SHARE_ENABLED, request)
            .await
    }

    pub(crate) async fn set_native_call_pip_enabled(
        &self,
        request: SetNativeCallPiPEnabledRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_PIP_ENABLED, request)
            .await
    }

    pub(crate) async fn switch_native_call_camera(
        &self,
        request: SwitchNativeCallCameraRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SWITCH_CAMERA, request).await
    }

    pub(crate) async fn set_native_call_remote_video_overlay(
        &self,
        request: SetNativeCallRemoteVideoOverlayRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_REMOTE_VIDEO_OVERLAY, request)
            .await
    }

    pub(crate) async fn clear_native_call_remote_video_overlay(
        &self,
        request: ClearNativeCallRemoteVideoOverlayRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::CLEAR_REMOTE_VIDEO_OVERLAY, request)
            .await
    }

    pub(crate) async fn set_native_call_local_video_overlay(
        &self,
        request: SetNativeCallLocalVideoOverlayRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_LOCAL_VIDEO_OVERLAY, request)
            .await
    }

    pub(crate) async fn clear_native_call_local_video_overlay(
        &self,
        request: ClearNativeCallLocalVideoOverlayRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::CLEAR_LOCAL_VIDEO_OVERLAY, request)
            .await
    }

    pub(crate) async fn start_system_call(
        &self,
        request: StartSystemCallRequest,
    ) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::START_SYSTEM_CALL, request)
            .await
    }

    pub(crate) async fn report_incoming_call(
        &self,
        request: ReportIncomingCallRequest,
    ) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::REPORT_INCOMING_CALL, request)
            .await
    }

    pub(crate) async fn end_system_call(&self, request: EndSystemCallRequest) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::END_SYSTEM_CALL, request)
            .await
    }

    pub(crate) async fn set_system_call_muted(
        &self,
        request: SetSystemCallMutedRequest,
    ) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::SET_SYSTEM_CALL_MUTED, request)
            .await
    }

    pub(crate) async fn drain_pending_system_call_actions(
        &self,
    ) -> crate::Result<Vec<SystemCallAction>> {
        self.invoke(platform_commands::DRAIN_PENDING_ACTIONS, ())
            .await
    }

    #[cfg(target_os = "ios")]
    pub(crate) async fn get_voip_token(&self) -> crate::Result<Option<String>> {
        let wire: VoipTokenWire = self.invoke(platform_commands::GET_VOIP_TOKEN, ()).await?;
        Ok(wire.token)
    }

    #[cfg(target_os = "android")]
    #[allow(clippy::unused_async)]
    pub(crate) async fn get_voip_token(&self) -> crate::Result<Option<String>> {
        Ok(None)
    }

    pub(crate) async fn fulfill_answer_call(
        &self,
        request: FulfillAnswerCallRequest,
    ) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::FULFILL_ANSWER_CALL, request)
            .await
    }

    pub(crate) async fn fulfill_end_call(
        &self,
        request: FulfillEndCallRequest,
    ) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::FULFILL_END_CALL, request)
            .await
    }

    pub(crate) async fn report_system_call_connected(
        &self,
        request: ReportConnectedRequest,
    ) -> crate::Result<()> {
        self.invoke_for_acknowledgement(platform_commands::REPORT_CONNECTED, request)
            .await
    }

    pub(crate) async fn set_native_call_encryption_key(
        &self,
        request: SetNativeCallEncryptionKeyRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::SET_ENCRYPTION_KEY, request)
            .await
    }

    pub(crate) async fn get_audio_routes(
        &self,
        request: GetAudioRoutesRequest,
    ) -> crate::Result<GetAudioRoutesResponse> {
        self.invoke(platform_commands::GET_AUDIO_ROUTES, request)
            .await
    }

    pub(crate) async fn set_audio_route(
        &self,
        request: SetAudioRouteRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke_for_snapshot(platform_commands::SET_AUDIO_ROUTE, request)
            .await
    }

    pub(crate) async fn set_audio_input(
        &self,
        request: SetAudioInputRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke_for_snapshot(platform_commands::SET_AUDIO_INPUT, request)
            .await
    }

    pub(crate) async fn update_call_display(
        &self,
        request: UpdateCallDisplayRequest,
    ) -> crate::Result<NativeCallSnapshot> {
        self.invoke_for_snapshot(platform_commands::UPDATE_CALL_DISPLAY, request)
            .await
    }

    pub(crate) async fn get_native_call_state(&self) -> crate::Result<NativeCallSnapshot> {
        self.invoke(platform_commands::GET_STATE, ()).await
    }
}

/// Native connect payload: the call fields plus the Tauri channel the native
/// room plugin uses to deliver snapshot events back into the actor.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeConnectCallRequest<'a> {
    #[serde(flatten)]
    pub fields: NativeConnectCallFields<'a>,
    pub channel: Channel<NativeCallChannelEvent>,
}

// Token must never land in logs: redact it in `Debug` (the contained fields
// already redact; `Channel` has no payload content to protect).
impl std::fmt::Debug for NativeConnectCallRequest<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeConnectCallRequest")
            .field("fields", &self.fields)
            .finish_non_exhaustive()
    }
}

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MobileBackend<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "LivekitMobilePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_livekit_mobile)?;
    Ok(MobileBackend::new(handle))
}
