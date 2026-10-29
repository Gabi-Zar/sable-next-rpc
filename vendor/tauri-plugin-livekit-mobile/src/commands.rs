// The attribute is aliased to `tauri_command` on purpose: tauri-typegen scans
// every .rs file under `src-tauri/` and treats a bare `#[command]` attribute as
// a root command, which would emit unusable unprefixed root bindings for these
// namespaced plugin commands that the guest-js API already exposes.
use tauri::{command as tauri_command, AppHandle, Runtime, Webview};

use crate::models::*;
use crate::NativeCallExt;
use crate::Result;

#[tauri_command]
pub(crate) async fn get_native_call_capabilities<R: Runtime>(
    app: AppHandle<R>,
) -> Result<NativeCallCapabilities> {
    app.native_call_bridge()
        .get_native_call_capabilities()
        .await
}

#[tauri_command]
pub(crate) async fn connect_native_call<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    payload: ConnectNativeCallRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .connect_native_call(payload, webview.label().to_string())
        .await
}

#[tauri_command]
pub(crate) async fn disconnect_native_call<R: Runtime>(
    app: AppHandle<R>,
    payload: DisconnectNativeCallRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .disconnect_native_call(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_microphone_enabled<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallMicrophoneEnabledRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_microphone_enabled(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_audio_processing<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallAudioProcessingRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_audio_processing(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_participant_volume<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallParticipantVolumeRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_participant_volume(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_camera_enabled<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallCameraEnabledRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_camera_enabled(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_screen_share_enabled<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallScreenShareEnabledRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_screen_share_enabled(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_pip_enabled<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallPiPEnabledRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_pip_enabled(payload)
        .await
}

#[tauri_command]
pub(crate) async fn switch_native_call_camera<R: Runtime>(
    app: AppHandle<R>,
    payload: SwitchNativeCallCameraRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .switch_native_call_camera(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_remote_video_overlay<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallRemoteVideoOverlayRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_remote_video_overlay(payload)
        .await
}

#[tauri_command]
pub(crate) async fn clear_native_call_remote_video_overlay<R: Runtime>(
    app: AppHandle<R>,
    payload: ClearNativeCallRemoteVideoOverlayRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .clear_native_call_remote_video_overlay(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_local_video_overlay<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallLocalVideoOverlayRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_local_video_overlay(payload)
        .await
}

#[tauri_command]
pub(crate) async fn clear_native_call_local_video_overlay<R: Runtime>(
    app: AppHandle<R>,
    payload: ClearNativeCallLocalVideoOverlayRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .clear_native_call_local_video_overlay(payload)
        .await
}

#[tauri_command]
pub(crate) async fn set_native_call_encryption_key<R: Runtime>(
    app: AppHandle<R>,
    payload: SetNativeCallEncryptionKeyRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .set_native_call_encryption_key(payload)
        .await
}

#[tauri_command]
pub(crate) async fn start_system_call<R: Runtime>(
    app: AppHandle<R>,
    payload: StartSystemCallRequest,
) -> Result<()> {
    app.native_call_bridge().start_system_call(payload).await
}

#[tauri_command]
pub(crate) async fn report_incoming_call<R: Runtime>(
    app: AppHandle<R>,
    payload: ReportIncomingCallRequest,
) -> Result<()> {
    app.native_call_bridge().report_incoming_call(payload).await
}

#[tauri_command]
pub(crate) async fn end_system_call<R: Runtime>(
    app: AppHandle<R>,
    payload: EndSystemCallRequest,
) -> Result<()> {
    app.native_call_bridge().end_system_call(payload).await
}

#[tauri_command]
pub(crate) async fn set_system_call_muted<R: Runtime>(
    app: AppHandle<R>,
    payload: SetSystemCallMutedRequest,
) -> Result<()> {
    app.native_call_bridge()
        .set_system_call_muted(payload)
        .await
}

#[tauri_command]
pub(crate) async fn get_voip_token<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>> {
    app.native_call_bridge().get_voip_token().await
}

#[tauri_command]
pub(crate) async fn drain_pending_system_call_actions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SystemCallAction>> {
    app.native_call_bridge()
        .drain_pending_system_call_actions()
        .await
}

#[tauri_command]
pub(crate) async fn fulfill_answer_call<R: Runtime>(
    app: AppHandle<R>,
    payload: FulfillAnswerCallRequest,
) -> Result<()> {
    app.native_call_bridge().fulfill_answer_call(payload).await
}

#[tauri_command]
pub(crate) async fn fulfill_end_call<R: Runtime>(
    app: AppHandle<R>,
    payload: FulfillEndCallRequest,
) -> Result<()> {
    app.native_call_bridge().fulfill_end_call(payload).await
}

#[tauri_command]
pub(crate) async fn report_system_call_connected<R: Runtime>(
    app: AppHandle<R>,
    payload: ReportConnectedRequest,
) -> Result<()> {
    app.native_call_bridge()
        .report_system_call_connected(payload)
        .await
}

#[tauri_command]
pub(crate) async fn get_native_call_state<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge()
        .get_native_call_state(webview.label().to_string())
        .await
}

#[tauri_command]
pub(crate) async fn get_audio_routes<R: Runtime>(
    app: AppHandle<R>,
    payload: GetAudioRoutesRequest,
) -> Result<GetAudioRoutesResponse> {
    app.native_call_bridge().get_audio_routes(payload).await
}

#[tauri_command]
pub(crate) async fn set_audio_route<R: Runtime>(
    app: AppHandle<R>,
    payload: SetAudioRouteRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge().set_audio_route(payload).await
}

#[tauri_command]
pub(crate) async fn set_audio_input<R: Runtime>(
    app: AppHandle<R>,
    payload: SetAudioInputRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge().set_audio_input(payload).await
}

#[tauri_command]
pub(crate) async fn update_call_display<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateCallDisplayRequest,
) -> Result<NativeCallSnapshot> {
    app.native_call_bridge().update_call_display(payload).await
}
