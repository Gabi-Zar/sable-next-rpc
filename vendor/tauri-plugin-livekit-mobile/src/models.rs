use serde::{Deserialize, Serialize};

/// Bounded connection-state vocabulary. `connectionState` on every native
/// snapshot deserializes into this enum, so an out-of-vocabulary native state
/// drops the payload instead of crossing the bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCallConnectionState {
    Idle,
    Connecting,
    Connected,
    Reconnecting,
    Failed,
}

/// Bounded failure vocabulary shared by command errors and snapshot
/// `lastError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCallFailureCode {
    InvalidRequest,
    Busy,
    PermissionDenied,
    ConnectFailed,
    MediaFailed,
    Disconnected,
    Cancelled,
    Unavailable,
    Unexpected,
}

impl NativeCallFailureCode {
    /// Wire code string.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::Busy => "busy",
            Self::PermissionDenied => "permission_denied",
            Self::ConnectFailed => "connect_failed",
            Self::MediaFailed => "media_failed",
            Self::Disconnected => "disconnected",
            Self::Cancelled => "cancelled",
            Self::Unavailable => "unavailable",
            Self::Unexpected => "unexpected",
        }
    }

    /// Static, safe message for the code. Native error strings are never
    /// forwarded.
    pub fn message(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "the call request was invalid",
            Self::Busy => "another call is already active",
            Self::PermissionDenied => "a microphone or camera permission was denied",
            Self::ConnectFailed => "the call failed to connect",
            Self::MediaFailed => "a microphone or camera update failed",
            Self::Disconnected => "the call connection ended unexpectedly",
            Self::Cancelled => "the operation was cancelled",
            Self::Unavailable => "the native call controller is unavailable",
            Self::Unexpected => "the call failed unexpectedly",
        }
    }
}

/// Sanitizes a native failure-code string into the bounded vocabulary.
/// Anything unrecognized degrades to [`NativeCallFailureCode::Unexpected`].
pub fn failure_code_from_raw(raw: Option<&str>) -> NativeCallFailureCode {
    match raw {
        Some("invalid_request") => NativeCallFailureCode::InvalidRequest,
        Some("busy") => NativeCallFailureCode::Busy,
        Some("permission_denied") => NativeCallFailureCode::PermissionDenied,
        Some("connect_failed") => NativeCallFailureCode::ConnectFailed,
        Some("media_failed") => NativeCallFailureCode::MediaFailed,
        Some("disconnected") => NativeCallFailureCode::Disconnected,
        Some("cancelled") => NativeCallFailureCode::Cancelled,
        Some("unavailable") => NativeCallFailureCode::Unavailable,
        Some("unexpected") => NativeCallFailureCode::Unexpected,
        _ => NativeCallFailureCode::Unexpected,
    }
}

/// Stable `{ code, message }` failure shape embedded in snapshots as
/// `lastError` and serialized for command errors. The message always comes
/// from the bounded code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallError {
    pub code: NativeCallFailureCode,
    pub message: String,
}

impl NativeCallError {
    pub fn from_code(code: NativeCallFailureCode) -> Self {
        Self {
            code,
            message: code.message().into(),
        }
    }
}

impl std::fmt::Display for NativeCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// What the native side can actually do on this device, so the guest can
/// gate a control instead of calling a command that will only ever reject.
///
/// Every flag is resolved by the native side at runtime, not derived from
/// the target platform: `picture_in_picture` in particular depends on the OS
/// version (iOS asks `AVPictureInPictureController`, Android needs API 31+
/// and an activity that declares `supportsPictureInPicture`), so a static
/// per-platform constant would be wrong on both.
///
/// `call_kit` is narrower than `system_calls`: it covers the CallKit-only
/// half of the system-call surface (`fulfillAnswerCall`, `fulfillEndCall`,
/// `reportSystemCallConnected`, `setSystemCallMuted`, `updateCallDisplay`),
/// which Android's Telecom backing has no equivalent for. `system_calls`
/// covers registering a call with the OS at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallCapabilities {
    pub supported: bool,
    pub microphone: bool,
    pub background_audio: bool,
    pub native_room: bool,
    pub camera: bool,
    pub native_video_overlay: bool,
    pub screen_share: bool,
    pub picture_in_picture: bool,
    pub call_kit: bool,
    pub system_calls: bool,
    pub audio_routes: bool,
    pub push_kit: bool,
}

impl NativeCallCapabilities {
    /// Truthful host capabilities: desktop has no native LiveKit room.
    pub fn current() -> Self {
        let supported = cfg!(any(target_os = "android", target_os = "ios"));
        Self {
            supported,
            microphone: supported,
            background_audio: supported,
            native_room: supported,
            camera: supported,
            native_video_overlay: false,
            screen_share: false,
            picture_in_picture: false,
            call_kit: false,
            system_calls: false,
            audio_routes: false,
            push_kit: false,
        }
    }
}

/// Mirrors the mobile capabilities responses: iOS reports
/// `{ microphone, backgroundAudio, camera, nativeVideoOverlay, callKit,
/// nativePiP }`, Android reports `{ microphone, audioPlayback, camera,
/// nativeVideoOverlay, screenShare, .. }`. Absent fields degrade to `false`,
/// so a native that predates a flag reports the feature missing rather than
/// claiming it; a resolved invocation is proof the native room bridge exists.
///
/// Kept in `models.rs` (not `mobile.rs`, which only compiles on mobile
/// targets) so the decode is regression-tested on the host.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallCapabilitiesWire {
    #[serde(default)]
    microphone: bool,
    #[serde(default, alias = "audioPlayback")]
    background_audio: bool,
    #[serde(default)]
    camera: bool,
    #[serde(default)]
    native_video_overlay: bool,
    #[serde(default)]
    screen_share: bool,
    #[serde(default, alias = "nativePiP")]
    picture_in_picture: bool,
    #[serde(default)]
    call_kit: bool,
    #[serde(default)]
    system_calls: bool,
    #[serde(default)]
    audio_routes: bool,
    #[serde(default)]
    push_kit: bool,
}

impl From<NativeCallCapabilitiesWire> for NativeCallCapabilities {
    fn from(native: NativeCallCapabilitiesWire) -> Self {
        Self {
            supported: true,
            microphone: native.microphone,
            background_audio: native.background_audio,
            // These commands exist only in the native room bridge.
            native_room: true,
            camera: native.camera,
            native_video_overlay: native.native_video_overlay,
            screen_share: native.screen_share,
            picture_in_picture: native.picture_in_picture,
            call_kit: native.call_kit,
            system_calls: native.system_calls,
            audio_routes: native.audio_routes,
            push_kit: native.push_kit,
        }
    }
}

/// Raw `{ code, message? }` pair as it may arrive inside native payloads. The
/// raw message is never forwarded: the guest-visible message is derived from
/// the bounded code alone.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawNativeCallError {
    code: String,
    #[serde(default)]
    #[allow(dead_code)]
    message: Option<String>,
}

fn deserialize_bounded_last_error<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<NativeCallError>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<RawNativeCallError>::deserialize(deserializer)?;
    Ok(raw.map(|raw| NativeCallError::from_code(failure_code_from_raw(Some(&raw.code)))))
}

/// Camera projection of one remote participant's camera publication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallRemoteCamera {
    pub sid: String,
    pub muted: bool,
    pub subscribed: bool,
}

/// Screen-share projection of one remote participant's screen-share
/// publication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallScreenShare {
    pub sid: String,
    pub muted: bool,
    pub subscribed: bool,
}

/// Microphone projection of one remote participant's audio publication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallRemoteMicrophone {
    pub sid: String,
    pub muted: bool,
    pub subscribed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallRemoteParticipant {
    pub identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<NativeCallRemoteCamera>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_share: Option<NativeCallScreenShare>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_share_audio: Option<NativeCallRemoteMicrophone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub microphone: Option<NativeCallRemoteMicrophone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_quality: Option<String>,
}

/// Wire shape of the native room snapshot resolved by native commands and
/// announced over the connect channel. `revision` is native-owned and passed
/// through unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCallSnapshot {
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub call_id: Option<String>,
    pub connection_state: NativeCallConnectionState,
    #[serde(default)]
    pub microphone_enabled: bool,
    #[serde(default)]
    pub camera_enabled: bool,
    #[serde(default)]
    pub screen_share_enabled: bool,
    #[serde(default)]
    pub participant_count: u32,
    // `default` keeps natives that predate the roster decodable.
    #[serde(default)]
    pub remote_participants: Vec<NativeCallRemoteParticipant>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_bounded_last_error"
    )]
    pub last_error: Option<NativeCallError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_connection_quality: Option<String>,
}

impl NativeCallSnapshot {
    /// True while the native side reports anything but an idle room.
    pub fn is_live(&self) -> bool {
        self.connection_state != NativeCallConnectionState::Idle
    }
}

/// The only channel event kind: snapshot announcements. Anything else fails
/// to deserialize here and is dropped by the channel.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum NativeCallChannelEvent {
    SnapshotChanged { snapshot: NativeCallSnapshot },
}

/// One shared-E2EE key: `key` is the raw key material, base64-encoded,
/// scoped to a participant `identity` and a `key_index`. Keys only flow
/// guest → native; they never appear in snapshots or events.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionKey {
    pub identity: String,
    pub key_index: u32,
    pub key: String,
}

// Key material must never land in logs: redact it in `Debug`.
impl std::fmt::Debug for EncryptionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncryptionKey")
            .field("identity", &self.identity)
            .field("key_index", &self.key_index)
            .field("key", &"[redacted]")
            .finish()
    }
}

/// One TURN/STUN server entry; mirrors the LiveKit ``IceServer`` shape.
/// Empty strings for `username` and `credential` are folded to `None` by the
/// native side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IceServerConfig {
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectNativeCallRequest {
    pub call_id: String,
    pub url: String,
    pub token: String,
    pub microphone_enabled: bool,
    /// Initial shared-E2EE keys the native side installs before
    /// `room.connect`. Empty (or omitted) means ordinary unencrypted
    /// LiveKit, keeping the plugin generic.
    #[serde(default)]
    pub encryption_keys: Vec<EncryptionKey>,
    /// Optional TURN/STUN servers forwarded to LiveKit ``ConnectOptions``.
    /// Omitted (or empty) means server-provided ICE only.
    #[serde(default)]
    pub ice_servers: Option<Vec<IceServerConfig>>,
    /// Overrides the default reconnection-attempt count (10).
    #[serde(default)]
    pub reconnect_attempts: Option<u32>,
    /// Omitted means every effect on, which is both SDKs' own default.
    #[serde(default)]
    pub audio_processing: AudioProcessingOptions,
    /// iOS only: the name shown in CallKit.
    #[serde(default)]
    pub caller_name: Option<String>,
}

// Token and key material must never land in logs: redact them in `Debug`.
impl std::fmt::Debug for ConnectNativeCallRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectNativeCallRequest")
            .field("call_id", &self.call_id)
            .field("url", &self.url)
            .field("token", &"[redacted]")
            .field("microphone_enabled", &self.microphone_enabled)
            .field("encryption_keys", &self.encryption_keys)
            .field("ice_servers", &self.ice_servers)
            .field("reconnect_attempts", &self.reconnect_attempts)
            .field("audio_processing", &self.audio_processing)
            .field("caller_name", &self.caller_name)
            .finish()
    }
}

/// Microphone processing the native capturer applies. Every field defaults to
/// `true`, which is what both platform SDKs capture with when the block is
/// omitted, so an older frontend keeps the behaviour it had.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProcessingOptions {
    #[serde(default = "enabled")]
    pub echo_cancellation: bool,
    #[serde(default = "enabled")]
    pub noise_suppression: bool,
    #[serde(default = "enabled")]
    pub auto_gain_control: bool,
}

fn enabled() -> bool {
    true
}

impl Default for AudioProcessingOptions {
    fn default() -> Self {
        Self {
            echo_cancellation: true,
            noise_suppression: true,
            auto_gain_control: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallAudioProcessingRequest {
    pub call_id: String,
    #[serde(flatten)]
    pub processing: AudioProcessingOptions,
}

/// `volume` is a gain, not a fraction: both SDKs take `0.0` (muted) to `10.0`
/// (10x), with `1.0` unity. The bridge clamps rather than rejects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallParticipantVolumeRequest {
    pub call_id: String,
    pub identity: String,
    pub volume: f64,
    #[serde(default)]
    pub screen_share: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectNativeCallRequest {
    pub call_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallMicrophoneEnabledRequest {
    pub call_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallCameraEnabledRequest {
    pub call_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallScreenShareEnabledRequest {
    pub call_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallPiPEnabledRequest {
    pub call_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchNativeCallCameraRequest {
    pub call_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallRemoteVideoOverlayRequest {
    pub call_id: String,
    pub participant_identity: String,
    pub track_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub device_pixel_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearNativeCallRemoteVideoOverlayRequest {
    pub call_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallLocalVideoOverlayRequest {
    pub call_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub device_pixel_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearNativeCallLocalVideoOverlayRequest {
    pub call_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSystemCallRequest {
    pub call_id: String,
    pub uuid: String,
    pub caller_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportIncomingCallRequest {
    pub call_id: String,
    pub uuid: String,
    pub caller_name: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub has_video: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndSystemCallRequest {
    pub call_id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub remote_ended: bool,
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSystemCallMutedRequest {
    pub call_id: String,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAudioRoutesRequest {
    pub call_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAudioRouteRequest {
    pub call_id: String,
    pub route_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAudioInputRequest {
    pub call_id: String,
    pub input_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCallDisplayRequest {
    pub call_id: String,
    pub caller_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_video: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FulfillAnswerCallRequest {
    pub uuid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FulfillEndCallRequest {
    pub uuid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportConnectedRequest {
    pub uuid: String,
}

/// System-call action enqueued by CallKit when JS is suspended and drained
/// by the guest via `drainPendingSystemCallActions`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCallAction {
    pub action: SystemCallActionKind,
    pub uuid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
    /// Carried on `Answer` so a lock-screen answer can reach the right call
    /// without the webview, which may still be suspended. iOS retains these
    /// from the VoIP push payload; Android does not populate them yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemCallActionKind {
    Answer,
    End,
    Mute,
}

/// Mid-call shared-E2EE key rotation/update for one participant identity.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNativeCallEncryptionKeyRequest {
    pub call_id: String,
    pub identity: String,
    pub key_index: u32,
    pub key: String,
}

// Key material must never land in logs: redact it in `Debug`.
impl std::fmt::Debug for SetNativeCallEncryptionKeyRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SetNativeCallEncryptionKeyRequest")
            .field("call_id", &self.call_id)
            .field("identity", &self.identity)
            .field("key_index", &self.key_index)
            .field("key", &"[redacted]")
            .finish()
    }
}

/// The connect payload fields forwarded to the native room plugins.
///
/// Kept in `models.rs` (not `mobile.rs`, which only compiles on mobile
/// targets) so the wire shape is regression-tested on the host.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeConnectCallFields<'a> {
    pub call_id: &'a str,
    pub url: &'a str,
    pub token: &'a str,
    pub microphone_enabled: bool,
    // Omitted entirely for ordinary unencrypted calls.
    #[serde(skip_serializing_if = "<[EncryptionKey]>::is_empty")]
    pub encryption_keys: &'a [EncryptionKey],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ice_servers: Option<&'a [IceServerConfig]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconnect_attempts: Option<u32>,
    pub audio_processing: AudioProcessingOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caller_name: Option<&'a str>,
}

// Token and key material must never land in logs: redact them in `Debug`.
impl std::fmt::Debug for NativeConnectCallFields<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeConnectCallFields")
            .field("call_id", &self.call_id)
            .field("url", &self.url)
            .field("token", &"[redacted]")
            .field("microphone_enabled", &self.microphone_enabled)
            .field("encryption_keys", &self.encryption_keys)
            .field("ice_servers", &self.ice_servers)
            .field("reconnect_attempts", &self.reconnect_attempts)
            .field("audio_processing", &self.audio_processing)
            .field("caller_name", &self.caller_name)
            .finish()
    }
}

/// Wire shape for `getAudioRoutes` response: an array of audio routes plus
/// the native room snapshot.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAudioRoutesResponse {
    pub routes: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputs: Option<serde_json::Value>,
    pub receiver: NativeCallSnapshot,
}

/// Wire shape for commands that wrap a snapshot in a `receiver` key
/// (`setAudioRoute`, `updateCallDisplay`).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandWithSnapshotResponse {
    pub receiver: NativeCallSnapshot,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn participant_volume_defaults_to_microphone_and_can_select_screen_audio() {
        for screen in [false, true] {
            let mut payload = serde_json::json!({
                "callId": "7", "identity": "alice", "volume": 0.6
            });
            if screen {
                payload["screenShare"] = serde_json::json!(true);
            }
            let request: SetNativeCallParticipantVolumeRequest =
                serde_json::from_value(payload).unwrap();
            assert_eq!(request.screen_share, screen);
            assert_eq!(
                serde_json::to_value(request).unwrap()["screenShare"],
                screen
            );
        }
    }

    #[test]
    fn screen_audio_publication_survives_snapshot_roundtrip() {
        let payload = serde_json::json!({
            "identity": "alice",
            "screenShareAudio": { "sid": "audio", "muted": false, "subscribed": true }
        });
        let participant: NativeCallRemoteParticipant =
            serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(
            participant.screen_share_audio.as_ref().unwrap().sid,
            "audio"
        );
        assert_eq!(serde_json::to_value(participant).unwrap(), payload);
    }

    #[test]
    fn connection_states_are_bounded_wire_values() {
        for (state, wire) in [
            (NativeCallConnectionState::Idle, "idle"),
            (NativeCallConnectionState::Connecting, "connecting"),
            (NativeCallConnectionState::Connected, "connected"),
            (NativeCallConnectionState::Reconnecting, "reconnecting"),
            (NativeCallConnectionState::Failed, "failed"),
        ] {
            assert_eq!(serde_json::to_value(state).unwrap(), wire);
            assert_eq!(
                serde_json::from_value::<NativeCallConnectionState>(serde_json::json!(wire))
                    .unwrap(),
                state
            );
        }
        assert!(
            serde_json::from_value::<NativeCallConnectionState>(serde_json::json!("starting"))
                .is_err()
        );
    }

    #[test]
    fn failure_codes_are_bounded_wire_values_with_static_messages() {
        for (code, wire) in [
            (NativeCallFailureCode::InvalidRequest, "invalid_request"),
            (NativeCallFailureCode::Busy, "busy"),
            (NativeCallFailureCode::PermissionDenied, "permission_denied"),
            (NativeCallFailureCode::ConnectFailed, "connect_failed"),
            (NativeCallFailureCode::MediaFailed, "media_failed"),
            (NativeCallFailureCode::Disconnected, "disconnected"),
            (NativeCallFailureCode::Cancelled, "cancelled"),
            (NativeCallFailureCode::Unavailable, "unavailable"),
            (NativeCallFailureCode::Unexpected, "unexpected"),
        ] {
            assert_eq!(code.code(), wire);
            assert_eq!(serde_json::to_value(code).unwrap(), wire);
            assert!(!code.message().is_empty());
        }
        assert!(
            serde_json::from_value::<NativeCallFailureCode>(serde_json::json!("internal_error"))
                .is_err()
        );
    }

    #[test]
    fn native_failure_codes_sanitize_into_the_bounded_vocabulary() {
        for (raw, bounded) in [
            ("invalid_request", NativeCallFailureCode::InvalidRequest),
            ("busy", NativeCallFailureCode::Busy),
            ("permission_denied", NativeCallFailureCode::PermissionDenied),
            ("connect_failed", NativeCallFailureCode::ConnectFailed),
            ("media_failed", NativeCallFailureCode::MediaFailed),
            ("disconnected", NativeCallFailureCode::Disconnected),
            ("cancelled", NativeCallFailureCode::Cancelled),
            ("unavailable", NativeCallFailureCode::Unavailable),
            ("unexpected", NativeCallFailureCode::Unexpected),
        ] {
            assert_eq!(failure_code_from_raw(Some(raw)), bounded, "code {raw}");
        }
        assert_eq!(
            failure_code_from_raw(Some("whatever_else")),
            NativeCallFailureCode::Unexpected
        );
        assert_eq!(
            failure_code_from_raw(None),
            NativeCallFailureCode::Unexpected
        );
    }

    #[test]
    fn snapshot_deserializes_native_truth_with_bounded_last_error() {
        let snapshot: NativeCallSnapshot = serde_json::from_value(serde_json::json!({
            "revision": 9,
            "callId": "call-1",
            "connectionState": "connected",
            "microphoneEnabled": true,
            "cameraEnabled": false,
            "participantCount": 2,
            "lastError": { "code": "media_failed", "message": "raw native detail" }
        }))
        .unwrap();
        assert_eq!(snapshot.revision, 9, "native revision passes through");
        assert_eq!(snapshot.call_id.as_deref(), Some("call-1"));
        assert_eq!(
            snapshot.connection_state,
            NativeCallConnectionState::Connected
        );
        assert!(snapshot.microphone_enabled);
        assert!(!snapshot.camera_enabled);
        assert_eq!(snapshot.participant_count, 2);
        assert!(snapshot.is_live());
        // Natives that predated the roster parse with an empty projection.
        assert_eq!(snapshot.remote_participants, Vec::new());
        assert_eq!(
            snapshot.last_error,
            Some(NativeCallError::from_code(
                NativeCallFailureCode::MediaFailed
            ))
        );
        let message = snapshot.last_error.unwrap().message;
        assert_ne!(message, "raw native detail");
    }

    #[test]
    fn snapshot_defaults_missing_fields_and_rejects_unknown_states() {
        let idle: NativeCallSnapshot =
            serde_json::from_value(serde_json::json!({ "connectionState": "idle" })).unwrap();
        assert_eq!(idle.revision, 0);
        assert_eq!(idle.call_id, None);
        assert!(!idle.microphone_enabled);
        assert!(!idle.camera_enabled);
        assert_eq!(idle.participant_count, 0);
        assert_eq!(idle.remote_participants, Vec::new());
        assert_eq!(idle.last_error, None);
        assert!(!idle.is_live());

        assert!(serde_json::from_value::<NativeCallSnapshot>(
            serde_json::json!({ "connectionState": "negotiating" })
        )
        .is_err());
        assert!(serde_json::from_value::<NativeCallSnapshot>(serde_json::json!({})).is_err());
    }

    #[test]
    fn snapshot_serializes_camel_case_omitting_clean_last_error() {
        let clean = serde_json::to_value(NativeCallSnapshot {
            revision: 4,
            call_id: Some("call-1".into()),
            connection_state: NativeCallConnectionState::Connected,
            microphone_enabled: true,
            camera_enabled: true,
            screen_share_enabled: false,
            participant_count: 3,
            remote_participants: Vec::new(),
            last_error: None,
            local_connection_quality: None,
        })
        .unwrap();
        assert_eq!(
            clean,
            serde_json::json!({
                "revision": 4,
                "callId": "call-1",
                "connectionState": "connected",
                "microphoneEnabled": true,
                "cameraEnabled": true,
                "screenShareEnabled": false,
                "participantCount": 3,
                "remoteParticipants": []
            })
        );

        let failed = serde_json::to_value(NativeCallSnapshot {
            revision: 5,
            call_id: Some("call-1".into()),
            connection_state: NativeCallConnectionState::Failed,
            microphone_enabled: true,
            camera_enabled: false,
            screen_share_enabled: false,
            participant_count: 3,
            remote_participants: Vec::new(),
            last_error: Some(NativeCallError::from_code(
                NativeCallFailureCode::Disconnected,
            )),
            local_connection_quality: None,
        })
        .unwrap();
        assert_eq!(
            failed["lastError"],
            serde_json::json!({
                "code": "disconnected",
                "message": "the call connection ended unexpectedly"
            })
        );
    }

    #[test]
    fn remote_participants_pass_through_with_optional_camera() {
        let snapshot: NativeCallSnapshot = serde_json::from_value(serde_json::json!({
            "revision": 7,
            "callId": "call-1",
            "connectionState": "connected",
            "microphoneEnabled": true,
            "cameraEnabled": false,
            "participantCount": 2,
            "remoteParticipants": [
                {
                    "identity": "@alice:example.org",
                    "camera": { "sid": "TR_abcdef", "muted": false, "subscribed": true }
                },
                { "identity": "@bob:example.org" }
            ]
        }))
        .unwrap();
        assert_eq!(
            snapshot.remote_participants,
            vec![
                NativeCallRemoteParticipant {
                    identity: "@alice:example.org".into(),
                    camera: Some(NativeCallRemoteCamera {
                        sid: "TR_abcdef".into(),
                        muted: false,
                        subscribed: true,
                    }),
                    screen_share: None,
                    screen_share_audio: None,
                    microphone: None,
                    connection_quality: None,
                },
                NativeCallRemoteParticipant {
                    identity: "@bob:example.org".into(),
                    camera: None,
                    screen_share: None,
                    screen_share_audio: None,
                    microphone: None,
                    connection_quality: None,
                },
            ]
        );

        // `camera` is omitted when there is no remote camera publication.
        assert_eq!(
            serde_json::to_value(&snapshot.remote_participants).unwrap(),
            serde_json::json!([
                {
                    "identity": "@alice:example.org",
                    "camera": { "sid": "TR_abcdef", "muted": false, "subscribed": true }
                },
                { "identity": "@bob:example.org" }
            ])
        );
    }

    #[test]
    fn channel_event_only_accepts_snapshot_changed() {
        let event: NativeCallChannelEvent = serde_json::from_value(serde_json::json!({
            "event": "snapshot_changed",
            "snapshot": {
                "revision": 11,
                "callId": "call-1",
                "connectionState": "reconnecting",
                "microphoneEnabled": false,
                "cameraEnabled": false,
                "participantCount": 1
            }
        }))
        .unwrap();
        let snapshot = match event {
            NativeCallChannelEvent::SnapshotChanged { snapshot } => snapshot,
        };
        assert_eq!(snapshot.revision, 11);
        assert_eq!(
            snapshot.connection_state,
            NativeCallConnectionState::Reconnecting
        );
    }

    #[test]
    fn connect_request_deserializes_camel_case_and_debug_redacts_token() {
        let request: ConnectNativeCallRequest = serde_json::from_value(serde_json::json!({
            "callId": "call-1",
            "url": "wss://livekit.example",
            "token": "secret-jwt",
            "microphoneEnabled": false
        }))
        .unwrap();
        assert_eq!(request.call_id, "call-1");
        // Omitted `encryptionKeys`: ordinary unencrypted call.
        assert!(request.encryption_keys.is_empty());
        assert!(request.caller_name.is_none());
        let debug = format!("{request:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("secret-jwt"));
    }

    #[test]
    fn connect_request_encryption_keys_parse_camel_case_and_debug_redacts_material() {
        let request: ConnectNativeCallRequest = serde_json::from_value(serde_json::json!({
            "callId": "call-1",
            "url": "wss://livekit.example",
            "token": "secret-jwt",
            "microphoneEnabled": true,
            "encryptionKeys": [
                { "identity": "@alice:example.org", "keyIndex": 0, "key": "c2VjcmV0LWtleQ==" },
                { "identity": "@bob:example.org", "keyIndex": 1, "key": "b3RoZXIta2V5" }
            ]
        }))
        .unwrap();
        assert_eq!(request.encryption_keys.len(), 2);
        assert_eq!(request.encryption_keys[0].identity, "@alice:example.org");
        assert_eq!(request.encryption_keys[0].key_index, 0);
        assert_eq!(request.encryption_keys[0].key, "c2VjcmV0LWtleQ==");

        // Empty `encryptionKeys` means the same as omitted.
        let plain: ConnectNativeCallRequest = serde_json::from_value(serde_json::json!({
            "callId": "call-1",
            "url": "wss://livekit.example",
            "token": "secret-jwt",
            "microphoneEnabled": true,
            "encryptionKeys": []
        }))
        .unwrap();
        assert!(plain.encryption_keys.is_empty());

        let debug = format!("{request:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("secret-jwt"));
        // Key material is redacted; identities and indexes stay visible.
        assert!(!debug.contains("c2VjcmV0LWtleQ=="));
        assert!(!debug.contains("b3RoZXIta2V5"));
        assert!(debug.contains("@alice:example.org"));
        assert!(debug.contains("key_index: 1"));
    }

    #[test]
    fn encryption_key_request_parses_camel_case_and_debug_redacts_material() {
        let request: SetNativeCallEncryptionKeyRequest =
            serde_json::from_value(serde_json::json!({
                "callId": "call-1",
                "identity": "@alice:example.org",
                "keyIndex": 3,
                "key": "c2VjcmV0LWtleQ=="
            }))
            .unwrap();
        assert_eq!(request.call_id, "call-1");
        assert_eq!(request.key_index, 3);
        let debug = format!("{request:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("c2VjcmV0LWtleQ=="));
    }

    #[test]
    fn native_wire_fields_serialize_camel_case_and_redact_token() {
        let fields = NativeConnectCallFields {
            call_id: "call-1",
            url: "wss://livekit.example",
            token: "secret-jwt",
            microphone_enabled: true,
            encryption_keys: &[],
            ice_servers: None,
            reconnect_attempts: None,
            audio_processing: AudioProcessingOptions::default(),
            caller_name: None,
        };
        // No E2EE keys: the `encryptionKeys` key is omitted entirely, so
        // natives that predate the field see an unchanged payload.
        assert_eq!(
            serde_json::to_value(&fields).unwrap(),
            serde_json::json!({
                "callId": "call-1",
                "url": "wss://livekit.example",
                "token": "secret-jwt",
                "microphoneEnabled": true,
                "audioProcessing": {
                    "echoCancellation": true,
                    "noiseSuppression": true,
                    "autoGainControl": true
                }
            })
        );
        let debug = format!("{fields:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("secret-jwt"));

        let keys = [EncryptionKey {
            identity: "@alice:example.org".into(),
            key_index: 0,
            key: "c2VjcmV0LWtleQ==".into(),
        }];
        let encrypted = NativeConnectCallFields {
            encryption_keys: &keys,
            ..fields
        };
        assert_eq!(
            serde_json::to_value(&encrypted).unwrap(),
            serde_json::json!({
                "callId": "call-1",
                "url": "wss://livekit.example",
                "token": "secret-jwt",
                "microphoneEnabled": true,
                "encryptionKeys": [
                    { "identity": "@alice:example.org", "keyIndex": 0, "key": "c2VjcmV0LWtleQ==" }
                ],
                "audioProcessing": {
                    "echoCancellation": true,
                    "noiseSuppression": true,
                    "autoGainControl": true
                }
            })
        );
        let debug = format!("{encrypted:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("c2VjcmV0LWtleQ=="));

        // Native key-rotation payload: camelCase wire, redacted Debug.
        let rotation = SetNativeCallEncryptionKeyRequest {
            call_id: "call-1".into(),
            identity: "@alice:example.org".into(),
            key_index: 2,
            key: "c2VjcmV0LWtleQ==".into(),
        };
        assert_eq!(
            serde_json::to_value(&rotation).unwrap(),
            serde_json::json!({
                "callId": "call-1",
                "identity": "@alice:example.org",
                "keyIndex": 2,
                "key": "c2VjcmV0LWtleQ=="
            })
        );
        let debug = format!("{rotation:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("c2VjcmV0LWtleQ=="));

        assert_eq!(
            serde_json::to_value(DisconnectNativeCallRequest {
                call_id: "call-1".into()
            })
            .unwrap(),
            serde_json::json!({ "callId": "call-1" })
        );
        assert_eq!(
            serde_json::to_value(SetNativeCallMicrophoneEnabledRequest {
                call_id: "call-1".into(),
                enabled: true
            })
            .unwrap(),
            serde_json::json!({ "callId": "call-1", "enabled": true })
        );
        assert_eq!(
            serde_json::to_value(SetNativeCallCameraEnabledRequest {
                call_id: "call-1".into(),
                enabled: false
            })
            .unwrap(),
            serde_json::json!({ "callId": "call-1", "enabled": false })
        );
        assert_eq!(
            serde_json::to_value(SetNativeCallRemoteVideoOverlayRequest {
                call_id: "call-1".into(),
                participant_identity: "@alice:example.org".into(),
                track_id: "TR_abcdef".into(),
                x: 10.0,
                y: 20.0,
                width: 320.0,
                height: 180.0,
                device_pixel_ratio: 2.0,
            })
            .unwrap(),
            serde_json::json!({
                "callId": "call-1",
                "participantIdentity": "@alice:example.org",
                "trackId": "TR_abcdef",
                "x": 10.0,
                "y": 20.0,
                "width": 320.0,
                "height": 180.0,
                "devicePixelRatio": 2.0
            })
        );
        assert_eq!(
            serde_json::to_value(SetNativeCallLocalVideoOverlayRequest {
                call_id: "call-1".into(),
                x: 10.0,
                y: 20.0,
                width: 320.0,
                height: 180.0,
                device_pixel_ratio: 2.0,
            })
            .unwrap(),
            serde_json::json!({
                "callId": "call-1",
                "x": 10.0,
                "y": 20.0,
                "width": 320.0,
                "height": 180.0,
                "devicePixelRatio": 2.0
            })
        );
    }

    /// Serialized payload for one outbound native command.
    fn wire(payload: impl Serialize) -> serde_json::Value {
        serde_json::to_value(payload).unwrap()
    }

    /// `NativeConnectCallRequest` also carries the Tauri `Channel`, which has
    /// no unit-testable serialization; the connect field set is pinned alone.
    #[test]
    fn native_connect_payload_pins_every_forwarded_field() {
        let keys = [EncryptionKey {
            identity: "@alice:example.org".into(),
            key_index: 4,
            key: "c2VjcmV0LWtleQ==".into(),
        }];
        let ice_servers = [IceServerConfig {
            urls: vec!["turn:turn.example:3478".into()],
            username: Some("turn-user".into()),
            credential: Some("turn-pass".into()),
        }];
        assert_eq!(
            wire(NativeConnectCallFields {
                call_id: "call-1",
                url: "wss://livekit.example",
                token: "secret-jwt",
                microphone_enabled: true,
                encryption_keys: &keys,
                ice_servers: Some(&ice_servers),
                reconnect_attempts: Some(3),
                audio_processing: AudioProcessingOptions {
                    echo_cancellation: false,
                    noise_suppression: false,
                    auto_gain_control: true,
                },
                caller_name: Some("Room A"),
            }),
            serde_json::json!({
                "callId": "call-1",
                "url": "wss://livekit.example",
                "token": "secret-jwt",
                "microphoneEnabled": true,
                "encryptionKeys": [
                    { "identity": "@alice:example.org", "keyIndex": 4, "key": "c2VjcmV0LWtleQ==" }
                ],
                "iceServers": [
                    {
                        "urls": ["turn:turn.example:3478"],
                        "username": "turn-user",
                        "credential": "turn-pass"
                    }
                ],
                "reconnectAttempts": 3,
                "audioProcessing": {
                    "echoCancellation": false,
                    "noiseSuppression": false,
                    "autoGainControl": true
                },
                "callerName": "Room A"
            })
        );
    }

    #[test]
    fn native_call_id_only_payloads_serialize_one_camel_case_field() {
        for payload in [
            wire(DisconnectNativeCallRequest {
                call_id: "call-1".into(),
            }),
            wire(GetAudioRoutesRequest {
                call_id: "call-1".into(),
            }),
        ] {
            assert_eq!(payload, serde_json::json!({ "callId": "call-1" }));
        }
    }

    #[test]
    fn native_media_toggle_payloads_serialize_call_id_and_enabled() {
        for payload in [
            wire(SetNativeCallMicrophoneEnabledRequest {
                call_id: "call-1".into(),
                enabled: true,
            }),
            wire(SetNativeCallCameraEnabledRequest {
                call_id: "call-1".into(),
                enabled: true,
            }),
            wire(SetNativeCallScreenShareEnabledRequest {
                call_id: "call-1".into(),
                enabled: true,
            }),
            wire(SetNativeCallPiPEnabledRequest {
                call_id: "call-1".into(),
                enabled: true,
            }),
        ] {
            assert_eq!(
                payload,
                serde_json::json!({ "callId": "call-1", "enabled": true })
            );
        }
    }

    #[test]
    fn native_uuid_only_payloads_serialize_one_uuid_field() {
        for payload in [
            wire(FulfillAnswerCallRequest {
                uuid: "3F2504E0-4F89-11D3-9A0C-0305E82C3301".into(),
            }),
            wire(FulfillEndCallRequest {
                uuid: "3F2504E0-4F89-11D3-9A0C-0305E82C3301".into(),
            }),
            wire(ReportConnectedRequest {
                uuid: "3F2504E0-4F89-11D3-9A0C-0305E82C3301".into(),
            }),
        ] {
            assert_eq!(
                payload,
                serde_json::json!({ "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301" })
            );
        }
    }

    #[test]
    fn native_system_call_payloads_pin_their_field_sets() {
        assert_eq!(
            wire(StartSystemCallRequest {
                call_id: "call-1".into(),
                uuid: "3F2504E0-4F89-11D3-9A0C-0305E82C3301".into(),
                caller_name: "Alice".into(),
            }),
            serde_json::json!({
                "callId": "call-1",
                "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
                "callerName": "Alice"
            })
        );
        // A local hangup omits `remoteEnded` entirely.
        assert_eq!(
            wire(EndSystemCallRequest {
                call_id: "call-1".into(),
                remote_ended: false,
            }),
            serde_json::json!({ "callId": "call-1" })
        );
        assert_eq!(
            wire(EndSystemCallRequest {
                call_id: "call-1".into(),
                remote_ended: true,
            }),
            serde_json::json!({ "callId": "call-1", "remoteEnded": true })
        );
        assert_eq!(
            wire(SetSystemCallMutedRequest {
                call_id: "call-1".into(),
                muted: true,
            }),
            serde_json::json!({ "callId": "call-1", "muted": true })
        );
    }

    #[test]
    fn native_audio_route_payload_pins_route_id() {
        assert_eq!(
            wire(SetAudioRouteRequest {
                call_id: "call-1".into(),
                route_id: "speaker".into(),
            }),
            serde_json::json!({ "callId": "call-1", "routeId": "speaker" })
        );
    }

    #[test]
    fn native_audio_input_payload_pins_input_id() {
        assert_eq!(
            wire(SetAudioInputRequest {
                call_id: "call-1".into(),
                input_id: "7".into(),
            }),
            serde_json::json!({ "callId": "call-1", "inputId": "7" })
        );
    }

    #[test]
    fn native_call_display_payload_omits_absent_has_video() {
        assert_eq!(
            wire(UpdateCallDisplayRequest {
                call_id: "call-1".into(),
                caller_name: "Alice".into(),
                has_video: Some(true),
            }),
            serde_json::json!({
                "callId": "call-1",
                "callerName": "Alice",
                "hasVideo": true
            })
        );
        assert_eq!(
            wire(UpdateCallDisplayRequest {
                call_id: "call-1".into(),
                caller_name: "Alice".into(),
                has_video: None,
            }),
            serde_json::json!({ "callId": "call-1", "callerName": "Alice" })
        );
    }

    #[test]
    fn native_encryption_key_payload_pins_identity_index_and_material() {
        assert_eq!(
            wire(SetNativeCallEncryptionKeyRequest {
                call_id: "call-1".into(),
                identity: "@alice:example.org".into(),
                key_index: 4,
                key: "c2VjcmV0LWtleQ==".into(),
            }),
            serde_json::json!({
                "callId": "call-1",
                "identity": "@alice:example.org",
                "keyIndex": 4,
                "key": "c2VjcmV0LWtleQ=="
            })
        );
    }

    #[test]
    fn native_video_overlay_payloads_pin_geometry() {
        assert_eq!(
            wire(SetNativeCallRemoteVideoOverlayRequest {
                call_id: "call-1".into(),
                participant_identity: "@alice:example.org".into(),
                track_id: "TR_abcdef".into(),
                x: -12.5,
                y: 20.0,
                width: 320.0,
                height: 180.5,
                device_pixel_ratio: 3.0,
            }),
            serde_json::json!({
                "callId": "call-1",
                "participantIdentity": "@alice:example.org",
                "trackId": "TR_abcdef",
                "x": -12.5,
                "y": 20.0,
                "width": 320.0,
                "height": 180.5,
                "devicePixelRatio": 3.0
            })
        );
        assert_eq!(
            wire(ClearNativeCallRemoteVideoOverlayRequest {
                call_id: "call-1".into(),
                track_id: Some("TR_abcdef".into()),
            }),
            serde_json::json!({ "callId": "call-1", "trackId": "TR_abcdef" })
        );
        assert_eq!(
            wire(ClearNativeCallRemoteVideoOverlayRequest {
                call_id: "call-1".into(),
                track_id: None,
            }),
            serde_json::json!({ "callId": "call-1" })
        );
        assert_eq!(
            wire(SetNativeCallLocalVideoOverlayRequest {
                call_id: "call-1".into(),
                x: -12.5,
                y: 20.0,
                width: 320.0,
                height: 180.5,
                device_pixel_ratio: 3.0,
            }),
            serde_json::json!({
                "callId": "call-1",
                "x": -12.5,
                "y": 20.0,
                "width": 320.0,
                "height": 180.5,
                "devicePixelRatio": 3.0
            })
        );
    }

    #[test]
    fn capabilities_serialize_camel_case_with_every_feature_flag() {
        assert_eq!(
            serde_json::to_value(NativeCallCapabilities {
                supported: true,
                microphone: true,
                background_audio: true,
                native_room: true,
                camera: false,
                native_video_overlay: true,
                screen_share: true,
                picture_in_picture: false,
                call_kit: true,
                system_calls: true,
                audio_routes: true,
                push_kit: false,
            })
            .unwrap(),
            serde_json::json!({
                "supported": true,
                "microphone": true,
                "backgroundAudio": true,
                "nativeRoom": true,
                "camera": false,
                "nativeVideoOverlay": true,
                "screenShare": true,
                "pictureInPicture": false,
                "callKit": true,
                "systemCalls": true,
                "audioRoutes": true,
                "pushKit": false
            })
        );
    }

    #[test]
    fn desktop_capabilities_claim_no_native_feature() {
        let current = NativeCallCapabilities::current();
        assert!(!current.native_video_overlay);
        assert!(!current.screen_share);
        assert!(!current.picture_in_picture);
        assert!(!current.call_kit);
        assert!(!current.system_calls);
        assert!(!current.audio_routes);
        assert!(!current.push_kit);
    }

    /// The iOS capabilities payload as `LivekitMobilePlugin.capabilities`
    /// resolves it, including the `nativePiP` spelling the Swift side uses.
    #[test]
    fn ios_capabilities_payload_decodes_with_the_native_pip_alias() {
        let wire: NativeCallCapabilitiesWire = serde_json::from_value(serde_json::json!({
            "microphone": true,
            "backgroundAudio": true,
            "camera": true,
            "nativeVideoOverlay": true,
            "callKit": true,
            "nativePiP": true
        }))
        .unwrap();
        let capabilities = NativeCallCapabilities::from(wire);
        // A resolved invocation is proof the native room bridge exists.
        assert!(capabilities.supported);
        assert!(capabilities.native_room);
        assert!(capabilities.background_audio);
        assert!(capabilities.native_video_overlay);
        assert!(capabilities.call_kit);
        assert!(capabilities.picture_in_picture);
        // Flags this native build does not report degrade to `false` rather
        // than claiming a feature the guest would then call into.
        assert!(!capabilities.screen_share);
        assert!(!capabilities.system_calls);
        assert!(!capabilities.audio_routes);
        assert!(!capabilities.push_kit);
    }

    /// The Android capabilities payload as `getNativeCallCapabilities`
    /// resolves it, including the `audioPlayback` spelling and the extra keys
    /// the bridge has no flag for.
    #[test]
    fn android_capabilities_payload_decodes_with_the_audio_playback_alias() {
        let wire: NativeCallCapabilitiesWire = serde_json::from_value(serde_json::json!({
            "platform": "android",
            "microphone": true,
            "audioPlayback": true,
            "foregroundService": true,
            "backgroundJavascript": false,
            "camera": true,
            "nativeVideoOverlay": true,
            "screenShare": false,
            "devicePicker": false
        }))
        .unwrap();
        let capabilities = NativeCallCapabilities::from(wire);
        assert!(capabilities.supported);
        assert!(capabilities.background_audio);
        assert!(capabilities.camera);
        assert!(!capabilities.screen_share);
        assert!(!capabilities.picture_in_picture);
        assert!(!capabilities.call_kit);
    }

    #[test]
    fn capabilities_wire_degrades_an_empty_payload_to_no_feature() {
        let capabilities = NativeCallCapabilities::from(
            serde_json::from_value::<NativeCallCapabilitiesWire>(serde_json::json!({})).unwrap(),
        );
        assert!(capabilities.supported);
        assert!(capabilities.native_room);
        assert!(!capabilities.microphone);
        assert!(!capabilities.background_audio);
        assert!(!capabilities.camera);
        assert!(!capabilities.native_video_overlay);
        assert!(!capabilities.screen_share);
        assert!(!capabilities.picture_in_picture);
        assert!(!capabilities.call_kit);
        assert!(!capabilities.system_calls);
        assert!(!capabilities.audio_routes);
        assert!(!capabilities.push_kit);
    }

    #[test]
    fn report_incoming_call_request_parses_camel_case_and_omits_absent_hints() {
        let request: ReportIncomingCallRequest = serde_json::from_value(serde_json::json!({
            "callId": "!room:example.org",
            "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
            "callerName": "Bob",
            "hasVideo": true,
            "roomId": "!room:example.org",
        }))
        .unwrap();
        assert!(request.has_video);
        assert_eq!(request.room_id.as_deref(), Some("!room:example.org"));

        // Both hints are optional, and absent ones stay off the wire.
        let minimal: ReportIncomingCallRequest = serde_json::from_value(serde_json::json!({
            "callId": "!room:example.org",
            "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
            "callerName": "Bob",
        }))
        .unwrap();
        assert!(!minimal.has_video);
        assert_eq!(minimal.room_id, None);
        assert_eq!(
            wire(minimal),
            serde_json::json!({
                "callId": "!room:example.org",
                "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
                "callerName": "Bob",
            })
        );
    }

    #[test]
    fn system_call_actions_decode_the_bounded_kinds_with_optional_muted() {
        let actions: Vec<SystemCallAction> = serde_json::from_value(serde_json::json!([
            { "action": "answer", "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301" },
            { "action": "end", "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3302" },
            { "action": "mute", "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3303", "muted": true }
        ]))
        .unwrap();
        assert_eq!(actions.len(), 3);
        assert_eq!(actions[0].action, SystemCallActionKind::Answer);
        assert_eq!(actions[0].muted, None);
        assert_eq!(actions[1].action, SystemCallActionKind::End);
        assert_eq!(actions[2].action, SystemCallActionKind::Mute);
        assert_eq!(actions[2].muted, Some(true));

        // `muted` is omitted rather than serialized as null when absent.
        assert_eq!(
            wire(SystemCallAction {
                action: SystemCallActionKind::Answer,
                uuid: "3F2504E0-4F89-11D3-9A0C-0305E82C3301".into(),
                muted: None,
                room_id: None,
                caller_name: None,
            }),
            serde_json::json!({
                "action": "answer",
                "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
            })
        );

        // An answer drained while the webview slept carries the identity the
        // guest needs to reach the call, since it cannot look the UUID up.
        assert_eq!(
            wire(SystemCallAction {
                action: SystemCallActionKind::Answer,
                uuid: "3F2504E0-4F89-11D3-9A0C-0305E82C3301".into(),
                muted: None,
                room_id: Some("!room:example.org".into()),
                caller_name: Some("Ada".into()),
            }),
            serde_json::json!({
                "action": "answer",
                "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
                "roomId": "!room:example.org",
                "callerName": "Ada"
            })
        );

        // A platform that does not populate them still decodes.
        let bare = serde_json::from_value::<SystemCallAction>(serde_json::json!({
            "action": "answer",
            "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
        }))
        .unwrap();
        assert_eq!(bare.room_id, None);
        assert_eq!(bare.caller_name, None);

        // Out-of-vocabulary kinds drop the action instead of crossing over.
        assert!(
            serde_json::from_value::<SystemCallAction>(serde_json::json!({
                "action": "hold",
                "uuid": "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
            }))
            .is_err()
        );
    }

    #[test]
    fn audio_routes_response_carries_the_routes_and_the_snapshot() {
        let response: GetAudioRoutesResponse = serde_json::from_value(serde_json::json!({
            "routes": [
                { "id": "speaker", "name": "Speaker", "type": "speaker", "current": true },
                { "id": "earpiece", "name": "Phone", "type": "earpiece", "current": false }
            ],
            "receiver": {
                "revision": 3,
                "callId": "call-1",
                "connectionState": "connected",
                "microphoneEnabled": true,
                "cameraEnabled": false,
                "participantCount": 1
            }
        }))
        .unwrap();
        // Routes are passed through untouched: the vocabulary is the native
        // side's, and the guest renders it.
        assert_eq!(response.routes.as_array().map(Vec::len), Some(2));
        assert_eq!(response.routes[0]["id"], "speaker");
        assert_eq!(response.receiver.revision, 3);
        assert_eq!(
            response.receiver.connection_state,
            NativeCallConnectionState::Connected
        );
    }

    /// `setAudioRoute` and `updateCallDisplay` wrap their snapshot in a
    /// `receiver` key; the bridge unwraps it so the guest sees a bare
    /// snapshot like every other command.
    #[test]
    fn snapshot_envelope_unwraps_the_receiver_key() {
        let envelope: CommandWithSnapshotResponse = serde_json::from_value(serde_json::json!({
            "receiver": {
                "revision": 12,
                "callId": "call-1",
                "connectionState": "reconnecting",
                "microphoneEnabled": false,
                "cameraEnabled": true,
                "participantCount": 2
            }
        }))
        .unwrap();
        assert_eq!(envelope.receiver.revision, 12);
        assert!(envelope.receiver.camera_enabled);
        assert!(envelope.receiver.is_live());

        // A bare snapshot is not a valid envelope: the wrapper is required.
        assert!(serde_json::from_value::<CommandWithSnapshotResponse>(
            serde_json::json!({ "connectionState": "connected" })
        )
        .is_err());
    }
}
