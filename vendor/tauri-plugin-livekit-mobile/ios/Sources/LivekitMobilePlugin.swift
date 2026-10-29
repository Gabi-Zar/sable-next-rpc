import AVKit
import Foundation
import LiveKit
import Tauri
import WebKit

// Wire contract summary (the shared Rust bridge owns the full schema):
// - Commands: capabilities, connect, disconnect, cancelConnect,
//   setMicrophoneEnabled, setCameraEnabled, switchCamera, getState,
//   setRemoteVideoOverlay, clearRemoteVideoOverlay, setEncryptionKey.
// - Every response is the authoritative snapshot
//   { revision, callId|null, connectionState, microphoneEnabled,
//     cameraEnabled, participantCount, lastError?: {code, message} }.
// - The only channel event is { event: "snapshot_changed", snapshot }.
//
// `token` is a LiveKit JWT: used only transiently to connect, and never
// logged, stored, or echoed back. E2EE key material (base64) is likewise
// only installed into the native key provider and never logged, echoed, or
// exposed through snapshots. Only bounded codes and static messages cross
// this boundary; native errors (which may embed URLs) are discarded.

/// A single TURN/STUN server entry: the wire shape for one array element.
/// Mirrors the LiveKit ``IceServer`` initialiser: urls (array of URLs),
/// optional `username` and `credential`.
struct BridgeIceServer: Decodable {
  let urls: [String]
  let username: String?
  let credential: String?
}

/// Matches both platform SDKs' own ceiling for a remote playout gain.
let maxParticipantVolume = 10.0

/// Microphone processing the capturer applies. Every field defaults to `true`,
/// which is the SDK's own default, so an older guest is unchanged.
struct BridgeAudioProcessing: Decodable {
  let echoCancellation: Bool?
  let noiseSuppression: Bool?
  let autoGainControl: Bool?

  var captureOptions: AudioCaptureOptions {
    AudioCaptureOptions(
      echoCancellation: echoCancellation ?? true,
      autoGainControl: autoGainControl ?? true,
      noiseSuppression: noiseSuppression ?? true)
  }
}

struct SetAudioProcessingArgs: Decodable {
  let callId: String
  let echoCancellation: Bool?
  let noiseSuppression: Bool?
  let autoGainControl: Bool?

  var captureOptions: AudioCaptureOptions {
    AudioCaptureOptions(
      echoCancellation: echoCancellation ?? true,
      autoGainControl: autoGainControl ?? true,
      noiseSuppression: noiseSuppression ?? true)
  }
}

struct SetParticipantVolumeArgs: Decodable {
  let callId: String
  let identity: String
  let volume: Double
  let screenShare: Bool?
}

struct ConnectArgs: Decodable {
  let callId: String
  let url: String
  let token: String
  let microphoneEnabled: Bool
  let audioProcessing: BridgeAudioProcessing?
  /// Per-participant E2EE key material. Absent or empty means an
  /// unencrypted (generic) call.
  let encryptionKeys: [EncryptionKeyPayload]?
  let channel: Channel?
  let iceServers: [BridgeIceServer]?
  let reconnectAttempts: Int?
  let callerName: String?
}

struct EncryptionKeyPayload: Decodable {
  let identity: String
  let keyIndex: Int32
  /// Base64-encoded raw key bytes.
  let key: String
}

struct SetEncryptionKeyArgs: Decodable {
  let callId: String
  let identity: String
  let keyIndex: Int32
  /// Base64-encoded rotated key bytes.
  let key: String
}

struct DisconnectArgs: Decodable {
  let callId: String
}

struct SetMicrophoneEnabledArgs: Decodable {
  let callId: String
  let enabled: Bool
}

struct SetCameraEnabledArgs: Decodable {
  let callId: String
  let enabled: Bool
}

struct SetScreenShareEnabledArgs: Decodable {
  let callId: String
  let enabled: Bool
}

// `cancelConnect`, `switchCamera` and `clearLocalVideoOverlay` reuse the
// `{ callId }` payload of `DisconnectArgs`.

struct SetLocalVideoOverlayArgs: Decodable {
  let callId: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let devicePixelRatio: Double
}

struct StartSystemCallArgs: Decodable {
  let callId: String
  let uuid: String
  let callerName: String
}

struct ReportIncomingCallArgs: Decodable {
  let callId: String
  let uuid: String
  let callerName: String
  let hasVideo: Bool?
  let roomId: String?
}

struct EndSystemCallArgs: Decodable {
  let callId: String
  let remoteEnded: Bool?
}

struct SetSystemCallMutedArgs: Decodable {
  let callId: String
  let muted: Bool
}

struct FulfillAnswerCallArgs: Decodable {
  let uuid: String
}

struct FulfillEndCallArgs: Decodable {
  let uuid: String
}

struct GetAudioRoutesArgs: Decodable {
  let callId: String
}

struct SetAudioRouteArgs: Decodable {
  let callId: String
  let routeId: String
}

struct UpdateCallDisplayArgs: Decodable {
  let callId: String
  let callerName: String
  let hasVideo: Bool?
}

struct ReportConnectedArgs: Decodable {
  let uuid: String
}

struct SetNativeCallPiPEnabledArgs: Decodable {
  let callId: String
  let enabled: Bool
}

struct ClearRemoteVideoOverlayArgs: Decodable {
  let callId: String
  let trackId: String?
}

struct SetRemoteVideoOverlayArgs: Decodable {
  let callId: String
  let participantIdentity: String
  /// The remote camera track's SID (the lane's wire name is `trackId`).
  let trackId: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  /// Present on the wire for cross-platform parity. iOS positions views in
  /// logical points, which already match CSS pixels, so this must never
  /// scale the rect.
  let devicePixelRatio: Double
}

/// Bounded connection-quality vocabulary mirrored from
/// LiveKit ``ConnectionQuality``. `.unknown` is intentionally omitted: absent
/// quality encodes as `nil` rather than an explicit wire string.
enum BridgeConnectionQuality: String, Encodable {
  case lost
  case poor
  case good
  case excellent
}

enum BridgeConnectionState: String, Encodable {
  case idle
  case connecting
  case connected
  case reconnecting
  case failed
}

/// Bounded failure codes; the raw values are part of the public contract.
/// Messages are static so they can never contain tokens, URLs, or native
/// error details.
enum BridgeFailureCode: String, Encodable {
  case invalidRequest = "invalid_request"
  case busy
  case permissionDenied = "permission_denied"
  case connectFailed = "connect_failed"
  case mediaFailed = "media_failed"
  case disconnected
  case cancelled
  case unavailable
  case unexpected

  var message: String {
    switch self {
    case .invalidRequest: return "Invalid request."
    case .busy: return "Another call is active."
    case .permissionDenied: return "Microphone or camera permission was denied."
    case .connectFailed: return "Failed to connect to the room."
    case .mediaFailed: return "Failed to change the media state."
    case .disconnected: return "Disconnected from the room."
    case .cancelled: return "The operation was superseded by a newer one."
    case .unavailable: return "The native call controller is unavailable."
    case .unexpected: return "An unexpected error occurred."
    }
  }
}

struct BridgeError: Encodable {
  let code: BridgeFailureCode
  let message: String

  init(_ code: BridgeFailureCode) {
    self.code = code
    self.message = code.message
  }
}

struct BridgeRemoteCamera: Encodable, Equatable {
  let sid: String
  let muted: Bool
  let subscribed: Bool
}

struct BridgeRemoteScreenShare: Encodable, Equatable {
  let sid: String
  let muted: Bool
  let subscribed: Bool
}

struct BridgeRemoteMicrophone: Encodable, Equatable {
  let sid: String
  let muted: Bool
  let subscribed: Bool
}

struct BridgeRemoteParticipant: Encodable, Equatable {
  let identity: String
  /// Present only while the participant has a camera publication.
  let camera: BridgeRemoteCamera?
  /// Present only while the participant has a screen-share publication.
  let screenShare: BridgeRemoteScreenShare?
  var screenShareAudio: BridgeRemoteMicrophone? = nil
  /// Present only while the participant has an audio publication.
  let microphone: BridgeRemoteMicrophone?
  /// Omitted when the SDK reports `.unknown`.
  let connectionQuality: BridgeConnectionQuality?
}

/// One selectable audio output route. `id` round-trips unchanged to
/// `setAudioRoute`; `type` is bounded to earpiece, speaker, wired, bluetooth
/// or unknown.
struct AudioRoute: Encodable {
  let id: String
  let name: String
  let type: String
  let current: Bool
}

/// Wire shape for `getAudioRoutes`.
///
/// These responses must be `Encodable` structs, not `[String: Any?]`
/// dictionaries: `Invoke.resolve(_ data: JsonObject)` runs the value through
/// `JSONSerialization.isValidJSONObject`, which rejects a Swift struct, and
/// `Invoke.serialize` then *resolves* with the error description instead of
/// failing. Passing an `Encodable` selects the `resolve<T: Encodable>`
/// overload, which uses `JSONEncoder`.
struct AudioRoutesResponse: Encodable {
  let routes: [AudioRoute]
  let receiver: BridgeStateResponse
}

/// Wire shape for the commands that wrap a snapshot in a `receiver` key.
struct SnapshotReceiverResponse: Encodable {
  let receiver: BridgeStateResponse
}

struct BridgeStateResponse: Encodable {
  let revision: UInt64
  let callId: String?
  let connectionState: BridgeConnectionState
  let microphoneEnabled: Bool
  let cameraEnabled: Bool
  let screenShareEnabled: Bool
  let participantCount: Int
  let remoteParticipants: [BridgeRemoteParticipant]
  let lastError: BridgeError?
  /// Omitted when empty (e.g. before the first quality event or when the SDK
  /// reports `.unknown`).
  let localConnectionQuality: BridgeConnectionQuality?

  // Custom encoding: `callId` must be an explicit JSON null when idle, while
  // the optional `lastError` key is omitted when absent.
  private enum CodingKeys: String, CodingKey {
    case revision
    case callId
    case connectionState
    case microphoneEnabled
    case cameraEnabled
    case screenShareEnabled
    case participantCount
    case remoteParticipants
    case lastError
    case localConnectionQuality
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(revision, forKey: .revision)
    try container.encode(callId, forKey: .callId)
    try container.encode(connectionState, forKey: .connectionState)
    try container.encode(microphoneEnabled, forKey: .microphoneEnabled)
    try container.encode(cameraEnabled, forKey: .cameraEnabled)
    try container.encode(screenShareEnabled, forKey: .screenShareEnabled)
    try container.encode(participantCount, forKey: .participantCount)
    try container.encode(remoteParticipants, forKey: .remoteParticipants)
    try container.encodeIfPresent(lastError, forKey: .lastError)
    try container.encodeIfPresent(localConnectionQuality, forKey: .localConnectionQuality)
  }
}

enum BridgeEventKind: String, Encodable {
  case snapshotChanged = "snapshot_changed"
}

/// The only payload ever sent over the call's event channel.
struct BridgeSnapshotEvent: Encodable {
  let event: BridgeEventKind
  let snapshot: BridgeStateResponse
}

struct BridgeCapabilities: Encodable {
  let microphone: Bool
  let backgroundAudio: Bool
  let camera: Bool
  let nativeVideoOverlay: Bool
  let screenShare: Bool
  let audioRoutes: Bool
  let systemCalls: Bool
  let callKit: Bool
  let nativePiP: Bool
}

/// Tauri-facing surface; all work is serialized through ``RoomController`` on
/// the main actor and every invoke settles exactly once.
///
/// Host app requirements: `NSMicrophoneUsageDescription` and
/// `NSCameraUsageDescription` in Info.plist, and the `audio`
/// `UIBackgroundModes` entry for room audio to survive backgrounding.
final class LivekitMobilePlugin: Plugin {
  private let controller = RoomController()
  /// CallKit bridge: system call UI + audio-session arbitration.
  private let callKitController = CallKitController()

  deinit {
    // The task retains the controller until teardown finishes; teardown bumps
    // the attempt identity so in-flight work settles with `cancelled`.
    Task { @MainActor [controller, callKitController] in
      callKitController.reset()
      await controller.tearDown()
    }
  }

  /// Retains the host webview (weakly, on the controller) so the remote
  /// video overlay can be positioned in its superview's coordinate space.
  /// Also sets up the LiveKit audio recipe (disable auto config + engine
  /// until CallKit grants a window) and wires the CallKitController's
  /// plugin reference for trigger delivery.
  @objc public override func load(webview: WKWebView) {
    forceLinkLiveKitObjCSurface()
    Task { @MainActor [weak controller, weak callKitController] in
      callKitController?.start()
      controller?.attachHostWebView(webview)
      controller?.callKitController = callKitController
      callKitController?.plugin = self
      callKitController?.roomController = controller
      // PushKit has to be registered every launch, foreground or background, or
      // the VoIP token is never delivered and incoming calls never arrive.
      callKitController?.setupPushKit()
    }
  }

  @objc public func capabilities(_ invoke: Invoke) throws {
    let piPAvailable: Bool
    if #available(iOS 15.0, *) {
      piPAvailable = AVPictureInPictureController.isPictureInPictureSupported()
    } else {
      piPAvailable = false
    }
    Task { @MainActor [callKitController] in
      let callKit = callKitController.isCallKitAvailable
      invoke.resolve(
        BridgeCapabilities(
          microphone: true, backgroundAudio: true, camera: true, nativeVideoOverlay: true,
          screenShare: true, audioRoutes: true, systemCalls: callKit,
          callKit: callKit, nativePiP: piPAvailable))
    }
  }

  @objc public func connect(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(ConnectArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.connect(args, invoke: invoke)
    }
  }

  @objc public func disconnect(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(DisconnectArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.disconnect(callId: args.callId, invoke: invoke)
    }
  }

  /// Timeout recovery for Rust: tears down the matching (possibly in-flight)
  /// attempt and resolves the idle snapshot; stale call ids are a no-op.
  @objc public func cancelConnect(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(DisconnectArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.cancelConnect(callId: args.callId, invoke: invoke)
    }
  }

  @objc public func setMicrophoneEnabled(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetMicrophoneEnabledArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.setMicrophoneEnabled(
        callId: args.callId, enabled: args.enabled, invoke: invoke)
    }
  }

  @objc public func setAudioProcessing(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetAudioProcessingArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.setAudioProcessing(
        callId: args.callId, processing: args.captureOptions, invoke: invoke)
    }
  }

  @objc public func setParticipantVolume(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetParticipantVolumeArgs.self),
      !args.identity.isEmpty, args.volume.isFinite
    else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.setParticipantVolume(
        callId: args.callId, identity: args.identity,
        volume: min(max(args.volume, 0), maxParticipantVolume),
        screenShare: args.screenShare ?? false, invoke: invoke)
    }
  }

  @objc public func setCameraEnabled(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetCameraEnabledArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.setCameraEnabled(
        callId: args.callId, enabled: args.enabled, invoke: invoke)
    }
  }

  @objc public func setScreenShareEnabled(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetScreenShareEnabledArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.setScreenShareEnabled(
        callId: args.callId, enabled: args.enabled, invoke: invoke)
    }
  }

  @objc public func switchCamera(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(DisconnectArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      await controller.switchCamera(callId: args.callId, invoke: invoke)
    }
  }

  /// Key rotation for an encrypted call: installs rotated key material for
  /// one participant identity. No snapshot event is emitted; key state
  /// never appears in the bridge contract.
  @objc public func setEncryptionKey(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetEncryptionKeyArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      controller.setEncryptionKey(
        callId: args.callId,
        identity: args.identity,
        keyIndex: args.keyIndex,
        key: args.key,
        invoke: invoke)
    }
  }

  @objc public func getState(_ invoke: Invoke) throws {
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      invoke.resolve(controller.snapshot())
    }
  }

  @objc public func setRemoteVideoOverlay(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetRemoteVideoOverlayArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      controller.setRemoteVideoOverlay(
        callId: args.callId,
        participantIdentity: args.participantIdentity,
        trackSid: args.trackId,
        frame: CGRect(x: args.x, y: args.y, width: args.width, height: args.height),
        devicePixelRatio: args.devicePixelRatio,
        invoke: invoke)
    }
  }

  @objc public func clearRemoteVideoOverlay(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(ClearRemoteVideoOverlayArgs.self),
      args.trackId.map({ !$0.trimmingCharacters(in: .whitespaces).isEmpty }) ?? true
    else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      controller.clearRemoteVideoOverlay(
        callId: args.callId, trackSid: args.trackId, invoke: invoke)
    }
  }

  @objc public func setLocalVideoOverlay(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetLocalVideoOverlayArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      controller.setLocalVideoOverlay(
        callId: args.callId,
        frame: CGRect(x: args.x, y: args.y, width: args.width, height: args.height),
        devicePixelRatio: args.devicePixelRatio,
        invoke: invoke)
    }
  }

  @objc public func clearLocalVideoOverlay(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(DisconnectArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      controller.clearLocalVideoOverlay(callId: args.callId, invoke: invoke)
    }
  }

  @objc public func setNativeCallPiPEnabled(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetNativeCallPiPEnabledArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak controller] in
      guard let controller else {
        reject(invoke, .unavailable)
        return
      }
      controller.setNativeCallPiPEnabled(
        callId: args.callId, enabled: args.enabled, invoke: invoke)
    }
  }

  // MARK: - System call (CallKit) commands

  @objc public func startSystemCall(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(StartSystemCallArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      guard let uuid = UUID(uuidString: args.uuid) else {
        reject(invoke, .invalidRequest)
        return
      }
      callKitController.startOutgoingCall(
        uuid: uuid, callId: args.callId, callerName: args.callerName
      ) { code in
        Self.settle(invoke, code)
      }
    }
  }

  @objc public func reportIncomingCall(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(ReportIncomingCallArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      guard let uuid = UUID(uuidString: args.uuid) else {
        reject(invoke, .invalidRequest)
        return
      }
      callKitController.reportIncomingCall(
        uuid: uuid, callerName: args.callerName, roomId: args.roomId ?? args.callId,
        hasVideo: args.hasVideo ?? false
      ) { code in
        Self.settle(invoke, code)
      }
    }
  }

  @objc public func endSystemCall(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(EndSystemCallArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      callKitController.endCall(
        callId: args.callId, remoteEnded: args.remoteEnded ?? false
      ) { code in
        Self.settle(invoke, code)
      }
    }
  }

  @objc public func setSystemCallMuted(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetSystemCallMutedArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      callKitController.setMuted(args.muted, for: args.callId) { code in
        Self.settle(invoke, code)
      }
    }
  }

  @objc public func getVoipToken(_ invoke: Invoke) throws {
    Task { @MainActor [weak callKitController] in
      if let token = callKitController?.voipToken {
        invoke.resolve(["token": token])
      } else {
        invoke.resolve([:])
      }
    }
  }

  @objc public func drainPendingSystemCallActions(_ invoke: Invoke) throws {
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      invoke.resolve(callKitController.drainPendingActions())
    }
  }

  @objc public func fulfillAnswerCall(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(FulfillAnswerCallArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      guard let uuid = UUID(uuidString: args.uuid) else {
        reject(invoke, .invalidRequest)
        return
      }
      callKitController.fulfillAnswerCall(uuid: uuid)
      invoke.resolve()
    }
  }

  @objc public func fulfillEndCall(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(FulfillEndCallArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      guard let uuid = UUID(uuidString: args.uuid) else {
        reject(invoke, .invalidRequest)
        return
      }
      callKitController.fulfillEndCall(uuid: uuid)
      invoke.resolve()
    }
  }

  @objc public func reportConnected(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(ReportConnectedArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController] in
      guard let callKitController else {
        reject(invoke, .unavailable)
        return
      }
      guard let uuid = UUID(uuidString: args.uuid) else {
        reject(invoke, .invalidRequest)
        return
      }
      callKitController.reportConnected(uuid: uuid)
      invoke.resolve()
    }
  }

  // MARK: - Extended CallKit commands

  @objc public func getAudioRoutes(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(GetAudioRoutesArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController, weak controller] in
      guard let callKitController, let controller else {
        reject(invoke, .unavailable)
        return
      }
      let routes = callKitController.getAudioRoutes(callId: args.callId)
      let snapshot = controller.snapshot()
      invoke.resolve(AudioRoutesResponse(routes: routes, receiver: snapshot))
    }
  }

  @objc public func setAudioRoute(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(SetAudioRouteArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController, weak controller] in
      guard let callKitController, let controller else {
        reject(invoke, .unavailable)
        return
      }
      callKitController.setAudioRoute(callId: args.callId, routeId: args.routeId)
      invoke.resolve(SnapshotReceiverResponse(receiver: controller.snapshot()))
    }
  }

  @objc public func updateCallDisplay(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(UpdateCallDisplayArgs.self) else {
      reject(invoke, .invalidRequest)
      return
    }
    Task { @MainActor [weak callKitController, weak controller] in
      guard let callKitController, let controller else {
        reject(invoke, .unavailable)
        return
      }
      callKitController.updateCallDisplay(
        callId: args.callId, callerName: args.callerName, hasVideo: args.hasVideo)
      invoke.resolve(SnapshotReceiverResponse(receiver: controller.snapshot()))
    }
  }

  private func reject(_ invoke: Invoke, _ code: BridgeFailureCode) {
    invoke.reject(code.message, code: code.rawValue)
  }

  /// Settles a CallKit command once the system has actually accepted or
  /// rejected the underlying transaction or report. `nil` means it went
  /// through; anything else is a bounded code from `CallKitController`.
  private static func settle(_ invoke: Invoke, _ code: BridgeFailureCode?) {
    if let code {
      invoke.reject(code.message, code: code.rawValue)
    } else {
      invoke.resolve()
    }
  }
}

@_cdecl("init_plugin_livekit_mobile")
func initPlugin() -> Plugin {
  LivekitMobilePlugin()
}
