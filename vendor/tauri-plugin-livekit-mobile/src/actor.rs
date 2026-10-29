//! Thin transport between the guest commands and the native room plugins.
//!
//! Only validation, time-bounded invocation forwarding, and owner-webview
//! event delivery live here; the contract itself is documented in the README.

use std::marker::PhantomData;

use tauri::{async_runtime, AppHandle, Runtime};
use tokio::sync::{mpsc, oneshot};

#[cfg(mobile)]
use tauri::{Emitter, EventTarget};

#[cfg(mobile)]
use crate::mobile::{MobileBackend, NativeConnectCallRequest};

use crate::error::{Error, Result};
#[cfg(not(mobile))]
use crate::models::NativeCallConnectionState;
use crate::models::{
    ClearNativeCallLocalVideoOverlayRequest, ClearNativeCallRemoteVideoOverlayRequest,
    ConnectNativeCallRequest, DisconnectNativeCallRequest, EndSystemCallRequest,
    FulfillAnswerCallRequest, FulfillEndCallRequest, GetAudioRoutesRequest, GetAudioRoutesResponse,
    NativeCallCapabilities, NativeCallFailureCode, NativeCallSnapshot, ReportConnectedRequest,
    ReportIncomingCallRequest, SetAudioInputRequest, SetAudioRouteRequest, SetNativeCallAudioProcessingRequest,
    SetNativeCallCameraEnabledRequest, SetNativeCallEncryptionKeyRequest,
    SetNativeCallLocalVideoOverlayRequest, SetNativeCallMicrophoneEnabledRequest,
    SetNativeCallParticipantVolumeRequest, SetNativeCallPiPEnabledRequest,
    SetNativeCallRemoteVideoOverlayRequest, SetNativeCallScreenShareEnabledRequest,
    SetSystemCallMutedRequest, StartSystemCallRequest, SwitchNativeCallCameraRequest,
    SystemCallAction, UpdateCallDisplayRequest,
};
#[cfg(mobile)]
use crate::models::{NativeCallChannelEvent, NativeConnectCallFields};

#[cfg(mobile)]
pub(crate) const NATIVE_CALL_EVENT: &str = "plugin:livekit-mobile://native-call-event";

/// Declares the commands whose bridge-side work is exactly "validate, then
/// forward to native": each entry generates the `Forwarded` variant, the
/// `NativeCallBridge` method, and both platform handlers.
///
/// `|r| ...` binds the whole request, so a command validating more than its
/// call id says so in the entry instead of growing a handler.
macro_rules! forwarded_commands {
    (
        $(
            $variant:ident($request:ty) -> $output:ty
                => $method:ident, |$request_ref:ident| $valid:expr;
        )*
    ) => {
        pub(crate) enum Forwarded {
            $($variant($request, oneshot::Sender<Result<$output>>),)*
        }

        impl<R: Runtime> NativeCallBridge<R> {
            $(
                pub async fn $method(&self, request: $request) -> Result<$output> {
                    self.send(|response| {
                        Command::Forwarded(Forwarded::$variant(request, response))
                    })
                    .await
                }
            )*
        }

        impl<R: Runtime> Actor<R> {
            #[cfg(mobile)]
            async fn handle_forwarded(&mut self, command: Forwarded) {
                match command {
                    $(
                        Forwarded::$variant(request, response) => {
                            let $request_ref = &request;
                            if !($valid) {
                                let _ = response.send(invalid_request());
                                return;
                            }
                            let result = self.mobile.$method(request).await;
                            let _ = response.send(result);
                        }
                    )*
                }
            }

            #[cfg(not(mobile))]
            async fn handle_forwarded(&mut self, command: Forwarded) {
                match command {
                    $(
                        Forwarded::$variant(request, response) => {
                            let _ = &request;
                            let _ = response.send(unavailable());
                        }
                    )*
                }
            }
        }
    };
}

/// Commands whose handler owns extra state: connect and disconnect move
/// `owner_label`, `GetNativeCallState` may claim it, drain has no request.
pub(crate) enum Command {
    GetNativeCallCapabilities(oneshot::Sender<Result<NativeCallCapabilities>>),
    ConnectNativeCall(
        ConnectNativeCallRequest,
        String,
        oneshot::Sender<Result<NativeCallSnapshot>>,
    ),
    DisconnectNativeCall(
        DisconnectNativeCallRequest,
        oneshot::Sender<Result<NativeCallSnapshot>>,
    ),
    GetNativeCallState(String, oneshot::Sender<Result<NativeCallSnapshot>>),
    DrainPendingSystemCallActions(oneshot::Sender<Result<Vec<SystemCallAction>>>),
    GetVoipToken(oneshot::Sender<Result<Option<String>>>),
    Forwarded(Forwarded),
}

forwarded_commands! {
    SetNativeCallMicrophoneEnabled(SetNativeCallMicrophoneEnabledRequest) -> NativeCallSnapshot
        => set_native_call_microphone_enabled, |r| call_id_is_valid(&r.call_id);
    SetNativeCallCameraEnabled(SetNativeCallCameraEnabledRequest) -> NativeCallSnapshot
        => set_native_call_camera_enabled, |r| call_id_is_valid(&r.call_id);
    SetNativeCallAudioProcessing(SetNativeCallAudioProcessingRequest) -> NativeCallSnapshot
        => set_native_call_audio_processing, |r| call_id_is_valid(&r.call_id);
    SetNativeCallParticipantVolume(SetNativeCallParticipantVolumeRequest) -> NativeCallSnapshot
        => set_native_call_participant_volume, |r| call_id_is_valid(&r.call_id)
            && !r.identity.trim().is_empty()
            && r.volume.is_finite();
    SetNativeCallScreenShareEnabled(SetNativeCallScreenShareEnabledRequest) -> NativeCallSnapshot
        => set_native_call_screen_share_enabled, |r| call_id_is_valid(&r.call_id);
    SetNativeCallPiPEnabled(SetNativeCallPiPEnabledRequest) -> NativeCallSnapshot
        => set_native_call_pip_enabled, |r| call_id_is_valid(&r.call_id);
    SwitchNativeCallCamera(SwitchNativeCallCameraRequest) -> NativeCallSnapshot
        => switch_native_call_camera, |r| call_id_is_valid(&r.call_id);
    SetNativeCallRemoteVideoOverlay(SetNativeCallRemoteVideoOverlayRequest) -> NativeCallSnapshot
        => set_native_call_remote_video_overlay, |r| remote_video_overlay_request_is_valid(r);
    ClearNativeCallRemoteVideoOverlay(ClearNativeCallRemoteVideoOverlayRequest) -> NativeCallSnapshot
        => clear_native_call_remote_video_overlay, |r| clear_remote_video_overlay_request_is_valid(r);
    SetNativeCallLocalVideoOverlay(SetNativeCallLocalVideoOverlayRequest) -> NativeCallSnapshot
        => set_native_call_local_video_overlay, |r| local_video_overlay_request_is_valid(r);
    ClearNativeCallLocalVideoOverlay(ClearNativeCallLocalVideoOverlayRequest) -> NativeCallSnapshot
        => clear_native_call_local_video_overlay, |r| call_id_is_valid(&r.call_id);
    SetNativeCallEncryptionKey(SetNativeCallEncryptionKeyRequest) -> NativeCallSnapshot
        => set_native_call_encryption_key, |r| call_id_is_valid(&r.call_id)
            && encryption_key_material_is_valid(&r.identity, &r.key);
    StartSystemCall(StartSystemCallRequest) -> ()
        => start_system_call, |r| !r.call_id.trim().is_empty()
            && !r.uuid.trim().is_empty()
            && !r.caller_name.trim().is_empty();
    ReportIncomingCall(ReportIncomingCallRequest) -> ()
        => report_incoming_call, |r| !r.call_id.trim().is_empty()
            && !r.uuid.trim().is_empty()
            && !r.caller_name.trim().is_empty();
    EndSystemCall(EndSystemCallRequest) -> ()
        => end_system_call, |r| !r.call_id.trim().is_empty();
    SetSystemCallMuted(SetSystemCallMutedRequest) -> ()
        => set_system_call_muted, |r| !r.call_id.trim().is_empty();
    FulfillAnswerCall(FulfillAnswerCallRequest) -> ()
        => fulfill_answer_call, |r| !r.uuid.trim().is_empty();
    FulfillEndCall(FulfillEndCallRequest) -> ()
        => fulfill_end_call, |r| !r.uuid.trim().is_empty();
    ReportSystemCallConnected(ReportConnectedRequest) -> ()
        => report_system_call_connected, |r| !r.uuid.trim().is_empty();
    GetAudioRoutes(GetAudioRoutesRequest) -> GetAudioRoutesResponse
        => get_audio_routes, |r| call_id_is_valid(&r.call_id);
    SetAudioRoute(SetAudioRouteRequest) -> NativeCallSnapshot
        => set_audio_route, |r| call_id_is_valid(&r.call_id)
            && !r.route_id.trim().is_empty();
    SetAudioInput(SetAudioInputRequest) -> NativeCallSnapshot
        => set_audio_input, |r| call_id_is_valid(&r.call_id)
            && !r.input_id.trim().is_empty();
    UpdateCallDisplay(UpdateCallDisplayRequest) -> NativeCallSnapshot
        => update_call_display, |r| call_id_is_valid(&r.call_id)
            && !r.caller_name.trim().is_empty();
}

#[cfg(any(mobile, test))]
fn connect_request_is_valid(request: &ConnectNativeCallRequest) -> bool {
    !(request.call_id.trim().is_empty()
        || request.url.trim().is_empty()
        || request.token.trim().is_empty())
        && request
            .encryption_keys
            .iter()
            .all(|key| encryption_key_material_is_valid(&key.identity, &key.key))
}

/// An E2EE key is well-formed when its identity is nonblank and `key` is
/// base64 that decodes to nonempty bytes. The decoded byte length is not
/// constrained: E2EE key sizes are the native side's decision, not the
/// bridge's.
#[cfg(any(mobile, test))]
fn encryption_key_material_is_valid(identity: &str, key: &str) -> bool {
    use base64::Engine;
    !identity.trim().is_empty()
        && base64::engine::general_purpose::STANDARD
            .decode(key)
            .map(|bytes| !bytes.is_empty())
            .unwrap_or(false)
}

#[cfg(any(mobile, test))]
fn call_id_is_valid(call_id: &str) -> bool {
    !call_id.trim().is_empty()
}

#[cfg(any(mobile, test))]
fn remote_video_overlay_request_is_valid(request: &SetNativeCallRemoteVideoOverlayRequest) -> bool {
    call_id_is_valid(&request.call_id)
        && !request.participant_identity.trim().is_empty()
        && !request.track_id.trim().is_empty()
        && request.x.is_finite()
        && request.y.is_finite()
        && request.width.is_finite()
        && request.width > 0.0
        && request.height.is_finite()
        && request.height > 0.0
        && request.device_pixel_ratio.is_finite()
        && request.device_pixel_ratio > 0.0
}

#[cfg(any(mobile, test))]
fn clear_remote_video_overlay_request_is_valid(
    request: &ClearNativeCallRemoteVideoOverlayRequest,
) -> bool {
    call_id_is_valid(&request.call_id)
        && request
            .track_id
            .as_deref()
            .is_none_or(|track_id| !track_id.trim().is_empty())
}

#[cfg(any(mobile, test))]
fn local_video_overlay_request_is_valid(request: &SetNativeCallLocalVideoOverlayRequest) -> bool {
    call_id_is_valid(&request.call_id)
        && request.x.is_finite()
        && request.y.is_finite()
        && request.width.is_finite()
        && request.width > 0.0
        && request.height.is_finite()
        && request.height > 0.0
        && request.device_pixel_ratio.is_finite()
        && request.device_pixel_ratio > 0.0
}

#[cfg(mobile)]
fn invalid_request<T>() -> Result<T> {
    Err(Error::failure(NativeCallFailureCode::InvalidRequest))
}

#[cfg(not(mobile))]
fn unavailable<T>() -> Result<T> {
    Err(Error::failure(NativeCallFailureCode::Unavailable))
}

#[cfg(not(mobile))]
fn idle_snapshot() -> NativeCallSnapshot {
    NativeCallSnapshot {
        revision: 0,
        call_id: None,
        connection_state: NativeCallConnectionState::Idle,
        microphone_enabled: false,
        camera_enabled: false,
        screen_share_enabled: false,
        participant_count: 0,
        remote_participants: Vec::new(),
        last_error: None,
        local_connection_quality: None,
    }
}

struct Actor<R: Runtime> {
    #[cfg(not(mobile))]
    _runtime: PhantomData<fn() -> R>,
    #[cfg(mobile)]
    app: AppHandle<R>,
    commands: mpsc::Receiver<Command>,
    #[cfg(mobile)]
    internal_tx: mpsc::UnboundedSender<NativeCallChannelEvent>,
    #[cfg(mobile)]
    internal_rx: mpsc::UnboundedReceiver<NativeCallChannelEvent>,
    #[cfg(mobile)]
    mobile: MobileBackend<R>,
    /// Webview label that currently receives snapshot events.
    #[cfg(mobile)]
    owner_label: Option<String>,
}

pub struct NativeCallBridge<R: Runtime> {
    commands: mpsc::Sender<Command>,
    _runtime: PhantomData<fn() -> R>,
}

impl<R: Runtime> NativeCallBridge<R> {
    #[cfg(not(mobile))]
    pub(crate) fn new(_app: AppHandle<R>) -> Self {
        let (commands, command_rx) = mpsc::channel(32);
        async_runtime::spawn(run_actor::<R>(command_rx));
        Self {
            commands,
            _runtime: PhantomData,
        }
    }

    #[cfg(mobile)]
    pub(crate) fn new(app: AppHandle<R>, mobile: MobileBackend<R>) -> Self {
        let (commands, command_rx) = mpsc::channel(32);
        let (internal_tx, internal_rx) = mpsc::unbounded_channel();
        async_runtime::spawn(run_actor(app, command_rx, internal_tx, internal_rx, mobile));
        Self {
            commands,
            _runtime: PhantomData,
        }
    }

    async fn send<T>(
        &self,
        command: impl FnOnce(oneshot::Sender<Result<T>>) -> Command,
    ) -> Result<T> {
        let (response, result) = oneshot::channel();
        self.commands
            .send(command(response))
            .await
            .map_err(|_| Error::failure(NativeCallFailureCode::Unavailable))?;
        result
            .await
            .map_err(|_| Error::failure(NativeCallFailureCode::Unavailable))?
    }

    pub async fn get_native_call_capabilities(&self) -> Result<NativeCallCapabilities> {
        self.send(Command::GetNativeCallCapabilities).await
    }

    pub async fn connect_native_call(
        &self,
        request: ConnectNativeCallRequest,
        owner_label: String,
    ) -> Result<NativeCallSnapshot> {
        self.send(|response| Command::ConnectNativeCall(request, owner_label, response))
            .await
    }

    pub async fn disconnect_native_call(
        &self,
        request: DisconnectNativeCallRequest,
    ) -> Result<NativeCallSnapshot> {
        self.send(|response| Command::DisconnectNativeCall(request, response))
            .await
    }

    pub async fn get_native_call_state(&self, caller_label: String) -> Result<NativeCallSnapshot> {
        self.send(|response| Command::GetNativeCallState(caller_label, response))
            .await
    }

    pub async fn drain_pending_system_call_actions(&self) -> Result<Vec<SystemCallAction>> {
        self.send(Command::DrainPendingSystemCallActions).await
    }

    pub async fn get_voip_token(&self) -> Result<Option<String>> {
        self.send(Command::GetVoipToken).await
    }
}

#[cfg(not(mobile))]
async fn run_actor<R: Runtime>(commands: mpsc::Receiver<Command>) {
    let mut actor: Actor<R> = Actor {
        _runtime: PhantomData,
        commands,
    };
    while let Some(command) = actor.commands.recv().await {
        actor.handle_command(command).await;
    }
}

#[cfg(mobile)]
async fn run_actor<R: Runtime>(
    app: AppHandle<R>,
    commands: mpsc::Receiver<Command>,
    internal_tx: mpsc::UnboundedSender<NativeCallChannelEvent>,
    internal_rx: mpsc::UnboundedReceiver<NativeCallChannelEvent>,
    mobile: MobileBackend<R>,
) {
    let mut actor = Actor {
        app,
        commands,
        internal_tx,
        internal_rx,
        mobile,
        owner_label: None,
    };
    loop {
        tokio::select! {
            command = actor.commands.recv() => {
                let Some(command) = command else { break };
                actor.handle_command(command).await;
            }
            internal = actor.internal_rx.recv() => {
                let Some(internal) = internal else { break };
                actor.handle_channel_event(internal);
            }
        }
    }
}

impl<R: Runtime> Actor<R> {
    async fn handle_command(&mut self, command: Command) {
        match command {
            Command::GetNativeCallCapabilities(response) => {
                self.handle_get_native_call_capabilities(response).await
            }
            Command::ConnectNativeCall(request, owner_label, response) => {
                self.handle_connect_native_call(request, owner_label, response)
                    .await
            }
            Command::DisconnectNativeCall(request, response) => {
                self.handle_disconnect_native_call(request, response).await
            }
            Command::GetNativeCallState(caller_label, response) => {
                self.handle_get_native_call_state(caller_label, response)
                    .await
            }
            Command::DrainPendingSystemCallActions(response) => {
                self.handle_drain_pending_system_call_actions(response)
                    .await
            }
            Command::GetVoipToken(response) => self.handle_get_voip_token(response).await,
            Command::Forwarded(command) => self.handle_forwarded(command).await,
        }
    }

    async fn handle_get_native_call_capabilities(
        &mut self,
        response: oneshot::Sender<Result<NativeCallCapabilities>>,
    ) {
        #[cfg(mobile)]
        let result = self.mobile.get_native_call_capabilities().await;
        #[cfg(not(mobile))]
        let result = Ok(NativeCallCapabilities::current());

        let _ = response.send(result);
    }

    #[cfg(mobile)]
    async fn handle_connect_native_call(
        &mut self,
        request: ConnectNativeCallRequest,
        owner_label: String,
        response: oneshot::Sender<Result<NativeCallSnapshot>>,
    ) {
        if !connect_request_is_valid(&request) {
            let _ = response.send(invalid_request());
            return;
        }

        // The channel hands snapshot events directly to the actor queue; the
        // sender half outlives this handler inside the native invoke payload.
        let channel = MobileBackend::<R>::native_call_event_channel(self.internal_tx.clone());
        let result = self
            .mobile
            .connect_native_call(NativeConnectCallRequest {
                fields: NativeConnectCallFields {
                    call_id: &request.call_id,
                    url: &request.url,
                    token: &request.token,
                    microphone_enabled: request.microphone_enabled,
                    encryption_keys: &request.encryption_keys,
                    ice_servers: request.ice_servers.as_deref(),
                    reconnect_attempts: request.reconnect_attempts,
                    audio_processing: request.audio_processing,
                    caller_name: request.caller_name.as_deref(),
                },
                channel,
            })
            .await;

        let result = match result {
            Ok(snapshot) => Ok(snapshot),
            Err(Error::Timeout) => {
                // Timeout recovery: the native connect may still be resolving,
                // so cancel it natively and reconcile against the native-truth
                // snapshot instead of just abandoning the channel (which would
                // orphan a room that survives cancellation from its events).
                let _ = self
                    .mobile
                    .cancel_native_call_connect(DisconnectNativeCallRequest {
                        call_id: request.call_id.clone(),
                    })
                    .await;
                match self.mobile.get_native_call_state().await {
                    Ok(snapshot) => Ok(snapshot),
                    Err(_) => Err(Error::Timeout),
                }
            }
            Err(error) => Err(error),
        };

        match result {
            Ok(snapshot) => {
                if snapshot.is_live() {
                    self.owner_label = Some(owner_label);
                }
                let _ = response.send(Ok(snapshot));
            }
            Err(Error::Timeout) => {
                // Native state stayed unknown; keep ownership so a still
                // running room keeps delivering events.
                self.owner_label = Some(owner_label);
                let _ = response.send(Err(Error::Timeout));
            }
            Err(error) => {
                let _ = response.send(Err(error));
            }
        }
    }

    #[cfg(not(mobile))]
    async fn handle_connect_native_call(
        &mut self,
        request: ConnectNativeCallRequest,
        owner_label: String,
        response: oneshot::Sender<Result<NativeCallSnapshot>>,
    ) {
        let _ = (&request, &owner_label);
        let _ = response.send(unavailable());
    }

    #[cfg(mobile)]
    async fn handle_disconnect_native_call(
        &mut self,
        request: DisconnectNativeCallRequest,
        response: oneshot::Sender<Result<NativeCallSnapshot>>,
    ) {
        if !call_id_is_valid(&request.call_id) {
            let _ = response.send(invalid_request());
            return;
        }
        let result = self.mobile.disconnect_native_call(request).await;
        if matches!(&result, Ok(snapshot) if !snapshot.is_live()) {
            self.owner_label = None;
        }
        let _ = response.send(result);
    }

    #[cfg(not(mobile))]
    async fn handle_disconnect_native_call(
        &mut self,
        request: DisconnectNativeCallRequest,
        response: oneshot::Sender<Result<NativeCallSnapshot>>,
    ) {
        let _ = &request;
        let _ = response.send(unavailable());
    }

    async fn handle_get_native_call_state(
        &mut self,
        caller_label: String,
        response: oneshot::Sender<Result<NativeCallSnapshot>>,
    ) {
        #[cfg(mobile)]
        let result = {
            let result = self.mobile.get_native_call_state().await;
            if let Ok(snapshot) = &result {
                // Ownership reclaim: the first webview to query an unowned
                // live room (e.g. after its owner webview was destroyed)
                // becomes the new event owner.
                if snapshot.is_live() && self.owner_label.is_none() && !caller_label.is_empty() {
                    self.owner_label = Some(caller_label.clone());
                }
            }
            result
        };
        #[cfg(not(mobile))]
        let result = {
            let _ = &caller_label;
            Ok(idle_snapshot())
        };

        let _ = response.send(result);
    }

    #[cfg(mobile)]
    async fn handle_drain_pending_system_call_actions(
        &mut self,
        response: oneshot::Sender<Result<Vec<SystemCallAction>>>,
    ) {
        let result = self.mobile.drain_pending_system_call_actions().await;
        let _ = response.send(result);
    }

    #[cfg(not(mobile))]
    async fn handle_drain_pending_system_call_actions(
        &mut self,
        response: oneshot::Sender<Result<Vec<SystemCallAction>>>,
    ) {
        let _ = response.send(unavailable());
    }

    #[cfg(mobile)]
    async fn handle_get_voip_token(&mut self, response: oneshot::Sender<Result<Option<String>>>) {
        let result = self.mobile.get_voip_token().await;
        let _ = response.send(result);
    }

    #[cfg(not(mobile))]
    async fn handle_get_voip_token(&mut self, response: oneshot::Sender<Result<Option<String>>>) {
        let _ = response.send(Ok(None));
    }

    #[cfg(mobile)]
    fn handle_channel_event(&mut self, event: NativeCallChannelEvent) {
        match event {
            NativeCallChannelEvent::SnapshotChanged { snapshot } => {
                // Targeted delivery: only the owner webview receives
                // snapshots; nothing is broadcast.
                let Some(label) = self.owner_label.clone() else {
                    return;
                };
                let live = snapshot.is_live();
                let _ = self
                    .app
                    .emit_to(EventTarget::webview(label), NATIVE_CALL_EVENT, snapshot);
                if !live {
                    self.owner_label = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        call_id_is_valid, clear_remote_video_overlay_request_is_valid, connect_request_is_valid,
        encryption_key_material_is_valid, local_video_overlay_request_is_valid,
        remote_video_overlay_request_is_valid,
    };
    use crate::models::{
        ClearNativeCallRemoteVideoOverlayRequest, ConnectNativeCallRequest, EncryptionKey,
        SetNativeCallLocalVideoOverlayRequest, SetNativeCallRemoteVideoOverlayRequest,
    };

    fn connect_request(call_id: &str) -> ConnectNativeCallRequest {
        ConnectNativeCallRequest {
            audio_processing: Default::default(),
            call_id: call_id.into(),
            url: "wss://livekit.example".into(),
            token: "jwt".into(),
            microphone_enabled: true,
            encryption_keys: Vec::new(),
            ice_servers: None,
            reconnect_attempts: None,
            caller_name: None,
        }
    }

    #[test]
    fn connect_validation_requires_nonempty_fields() {
        assert!(connect_request_is_valid(&connect_request("call")));

        assert!(!connect_request_is_valid(&connect_request(" ")));
        let mut blank_url = connect_request("call");
        blank_url.url = String::new();
        assert!(!connect_request_is_valid(&blank_url));
        let mut blank_token = connect_request("call");
        blank_token.token = "  ".into();
        assert!(!connect_request_is_valid(&blank_token));
    }

    #[test]
    fn encryption_key_material_validation() {
        // "secret" padded and "other" unpadded-well-formed base64.
        assert!(encryption_key_material_is_valid("@alice:e.org", "c2VjcmV0"));
        assert!(!encryption_key_material_is_valid(" ", "c2VjcmV0"));
        assert!(!encryption_key_material_is_valid("@alice:e.org", ""));
        assert!(!encryption_key_material_is_valid("@alice:e.org", "   "));
        assert!(!encryption_key_material_is_valid(
            "@alice:e.org",
            "not base64!!"
        ));
        // Wrong padding / truncated input is rejected.
        assert!(!encryption_key_material_is_valid(
            "@alice:e.org",
            "c2VjcmV="
        ));
    }

    #[test]
    fn connect_validation_rejects_invalid_encryption_keys() {
        let mut request = connect_request("call");
        request.encryption_keys = vec![
            EncryptionKey {
                identity: "@alice:e.org".into(),
                key_index: 0,
                key: "c2VjcmV0".into(),
            },
            EncryptionKey {
                identity: "@bob:e.org".into(),
                key_index: 1,
                key: "b3RoZXI=".into(),
            },
        ];
        assert!(connect_request_is_valid(&request));

        request.encryption_keys[1].key = "!!!".into();
        assert!(!connect_request_is_valid(&request));
        request.encryption_keys[1].key = "b3RoZXI=".into();
        request.encryption_keys[0].identity = "  ".into();
        assert!(!connect_request_is_valid(&request));
    }

    #[test]
    fn call_id_validation_rejects_empty_and_blank() {
        assert!(call_id_is_valid("call"));
        assert!(!call_id_is_valid(""));
        assert!(!call_id_is_valid("   "));
    }

    #[test]
    fn remote_video_overlay_validation_requires_identifiers_and_valid_geometry() {
        let request = SetNativeCallRemoteVideoOverlayRequest {
            call_id: "call".into(),
            participant_identity: "@alice:example.org".into(),
            track_id: "TR_abcdef".into(),
            x: -120.0,
            y: -50.0,
            width: 320.0,
            height: 180.0,
            device_pixel_ratio: 2.0,
        };
        assert!(remote_video_overlay_request_is_valid(&request));

        for invalid in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            let mut invalid_request = request.clone();
            invalid_request.width = invalid;
            assert!(!remote_video_overlay_request_is_valid(&invalid_request));
        }
        let mut invalid_x = request.clone();
        invalid_x.x = f64::NAN;
        assert!(!remote_video_overlay_request_is_valid(&invalid_x));
        let mut invalid_y = request.clone();
        invalid_y.y = f64::INFINITY;
        assert!(!remote_video_overlay_request_is_valid(&invalid_y));
        let mut invalid_height = request.clone();
        invalid_height.height = 0.0;
        assert!(!remote_video_overlay_request_is_valid(&invalid_height));
        let mut invalid_dpr = request.clone();
        invalid_dpr.device_pixel_ratio = 0.0;
        assert!(!remote_video_overlay_request_is_valid(&invalid_dpr));
        let mut blank_track = request;
        blank_track.track_id = " ".into();
        assert!(!remote_video_overlay_request_is_valid(&blank_track));
    }

    #[test]
    fn remote_video_overlay_clear_accepts_one_track_or_all() {
        let clear =
            |call_id: &str, track_id: Option<&str>| ClearNativeCallRemoteVideoOverlayRequest {
                call_id: call_id.into(),
                track_id: track_id.map(Into::into),
            };
        assert!(clear_remote_video_overlay_request_is_valid(&clear(
            "call", None
        )));
        assert!(clear_remote_video_overlay_request_is_valid(&clear(
            "call",
            Some("TR_abcdef")
        )));
        assert!(!clear_remote_video_overlay_request_is_valid(&clear(
            "call",
            Some(" ")
        )));
        assert!(!clear_remote_video_overlay_request_is_valid(&clear(
            " ", None
        )));
    }

    #[test]
    fn local_video_overlay_validation_requires_valid_geometry_and_call_id() {
        let request = SetNativeCallLocalVideoOverlayRequest {
            call_id: "call".into(),
            x: -120.0,
            y: -50.0,
            width: 320.0,
            height: 180.0,
            device_pixel_ratio: 2.0,
        };
        assert!(local_video_overlay_request_is_valid(&request));

        for invalid in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            let mut invalid_request = request.clone();
            invalid_request.width = invalid;
            assert!(!local_video_overlay_request_is_valid(&invalid_request));
        }
        let mut invalid_x = request.clone();
        invalid_x.x = f64::NAN;
        assert!(!local_video_overlay_request_is_valid(&invalid_x));
        let mut invalid_y = request.clone();
        invalid_y.y = f64::INFINITY;
        assert!(!local_video_overlay_request_is_valid(&invalid_y));
        let mut invalid_dpr = request.clone();
        invalid_dpr.device_pixel_ratio = 0.0;
        assert!(!local_video_overlay_request_is_valid(&invalid_dpr));
        let mut blank_call = request;
        blank_call.call_id = " ".into();
        assert!(!local_video_overlay_request_is_valid(&blank_call));
    }

    #[cfg(not(mobile))]
    #[test]
    fn desktop_idle_snapshot_has_empty_room_projection() {
        let idle = super::idle_snapshot();
        assert_eq!(idle.revision, 0);
        assert_eq!(idle.call_id, None);
        assert_eq!(idle.remote_participants, Vec::new());
        assert!(!idle.is_live());
    }
}
