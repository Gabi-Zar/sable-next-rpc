import AVFoundation
import AVKit
import LiveKit
import Tauri
import UIKit
import WebKit

/// Serialized owner of the single native LiveKit room behind the bridge.
///
/// All state is main-actor isolated. LiveKit invokes RoomDelegate callbacks
/// on its own multicast queue (not main), so every delegate method hops onto
/// the main actor and verifies `room === self.room` before mutating.
///
/// `attempt` identifies the current call attempt: it is bumped whenever the
/// attempt is replaced or torn down, so stale async work settles its invoke
/// with `cancelled` at its next suspension point instead of mutating state
/// that now belongs to a newer attempt.
///
/// All state mutations publish through `emitSnapshotChanged`, which owns the
/// revision bump.
///
/// LiveKit's AudioManager owns the AVAudioSession for the room lifecycle
/// (category, mode, activation); do not configure it here. The only
/// session-adjacent work in this bridge is the media permission requests
/// before publishing.
@MainActor
final class RoomController: NSObject {
  // Nonisolated init so the plugin can construct the controller off the main
  // actor; all state access stays main-actor serialized.
  nonisolated override init() {
    super.init()
    let center = NotificationCenter.default
    center.addObserver(
      self,
      selector: #selector(handleCaptureSessionInterruption(_:)),
      name: AVCaptureSession.wasInterruptedNotification,
      object: nil
    )
    center.addObserver(
      self,
      selector: #selector(handleCaptureSessionInterruptionEnded),
      name: AVCaptureSession.interruptionEndedNotification,
      object: nil
    )
    center.addObserver(
      self,
      selector: #selector(handleApplicationDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
  }

  /// The controller lives as long as the plugin, so the observers are only
  /// dropped with the instance itself.
  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  private var room: Room?
  private var channel: Channel?
  private var callId: String?
  /// Per-call E2EE key provider. Non-nil only while the current attempt is
  /// encrypted; created with all initial key material installed before the
  /// Room exists, so rotation is accepted for the whole `connecting` phase.
  private var keyProvider: BaseKeyProvider?
  private var revision: UInt64 = 0
  private var connectionState: BridgeConnectionState = .idle
  private var microphoneEnabled = false
  private var cameraEnabled = false
  /// Set while this controller, not the user, muted the camera because its
  /// capture session was interrupted. It is what tells the restore path that
  /// the camera was on before the interruption and may be turned back on.
  private var cameraMutedByInterruption = false
  private var screenShareEnabled = false
  private var participantCount = 0
  private var remoteParticipants: [BridgeRemoteParticipant] = []
  private var lastError: BridgeError?
  /// Capture processing for this call's microphone. The room is built with it
  /// and a later change is pushed to the live track.
  private var audioProcessing = AudioCaptureOptions()
  // Reapply volumes when LiveKit replaces tracks.
  private var participantVolumes: [String: Double] = [:]
  private var screenShareVolumes: [String: Double] = [:]
  /// Local connection quality from the last
  /// `room(_:participant:didUpdateConnectionQuality:)` delegate event for the
  /// local participant. Nil until the first such event arrives.
  private var localConnectionQuality: BridgeConnectionQuality? = nil
  private var attempt: UInt64 = 0

  // MARK: Remote video overlay state

  /// Weak handle to the Tauri webview, retained from `Plugin.load(webview:)`.
  /// The overlay's frame is positioned in this view's superview.
  private weak var hostWebView: WKWebView?
  /// One non-interactive native renderer per remote video track, in
  /// placement order.
  private var remoteOverlays: [RemoteOverlay] = []

  /// How long a dropped socket may stay in `reconnecting` before the call is
  /// reported as terminally failed.
  /// Pending promotion of a stalled reconnect to `.failed`. Cancelled when the
  /// room reconnects or is torn down.

  // MARK: Native Picture-in-Picture (iOS 15+)

  /// Whether native PiP is enabled for the current call. The JS lane
  /// controls this via `setNativeCallPiPEnabled`.
  private var pipEnabled: Bool = false
  /// The AVPictureInPictureController (iOS 15+) that manages the PiP
  /// lifecycle. Non-nil once PiP is armed against a bound overlay track.
  private var pipController: Any? = nil
  /// The AVPictureInPictureVideoCallViewController that hosts the PiP
  /// renderer.
  private var pipViewController: Any? = nil
  /// The track the PiP view controller is registered on as a renderer, bound
  /// to the same track as the PiP source overlay. Apple's video-call PiP expects a
  /// separate content view controller with the on-screen view as the distinct
  /// `activeVideoCallSourceView`, so the in-app tile is never re-parented into
  /// the PiP window. Kept so a rebind can unregister from the previous track.
  private var pipTrack: VideoTrack?

  private struct OverlaySelection {
    let participantIdentity: String
    let trackSid: String
  }

  private struct RemoteOverlay {
    var selection: OverlaySelection
    let view: VideoView
  }

  // MARK: Local camera preview overlay state

  /// Second non-interactive native renderer for the local camera track.
  /// Independent from the remote overlays; they can coexist on-screen.
  private var localOverlayView: VideoView?

  // MARK: CallKit integration

  /// Weak reference for pushing system call start/end/mute events back to
  /// the CallKit controller. Set by the plugin after init.
  weak var callKitController: CallKitController?

  /// Called from `Plugin.load(webview:)`; the reference stays weak so the
  /// plugin never extends the webview's lifetime.
  func attachHostWebView(_ webView: WKWebView) {
    hostWebView = webView
  }

  // MARK: - Snapshot

  func snapshot() -> BridgeStateResponse {
    BridgeStateResponse(
      revision: revision,
      callId: callId,
      connectionState: connectionState,
      microphoneEnabled: microphoneEnabled,
      cameraEnabled: cameraEnabled,
      screenShareEnabled: screenShareEnabled,
      participantCount: participantCount,
      remoteParticipants: remoteParticipants,
      lastError: lastError,
      localConnectionQuality: localConnectionQuality)
  }

  /// Publishes the current snapshot on the active call's channel and bumps
  /// the revision. No-op without an active channel.
  private func emitSnapshotChanged() {
    guard let channel else { return }
    revision &+= 1
    try? channel.send(
      BridgeSnapshotEvent(event: .snapshotChanged, snapshot: snapshot()))
  }

  // MARK: - Commands

  func connect(_ args: ConnectArgs, invoke: Invoke) async {
    // An active attempt blocks a different call; the same call is a no-op.
    switch connectionState {
    case .connecting, .connected, .reconnecting:
      if callId == args.callId {
        invoke.resolve(snapshot())
      } else {
        reject(invoke, .busy)
      }
      return
    case .idle, .failed:
      break
    }

    // Decode the optional E2EE key material up front: malformed base64 or
    // negative indexes reject through the bounded invalid-request path
    // without disturbing any state. Absent or empty means unencrypted.
    guard let keyMaterial = Self.decodeKeyMaterial(from: args.encryptionKeys) else {
      reject(invoke, .invalidRequest)
      return
    }

    attempt &+= 1
    let attemptId = attempt

    // Clear a leftover room from a failed attempt, if any.
    if let staleRoom = room {
      room = nil
      keyProvider = nil
      removeOverlayViews()
      removeLocalOverlayView()
      await staleRoom.disconnect()
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
    }

    callId = args.callId
    channel = args.channel
    lastError = nil
    microphoneEnabled = false
    cameraEnabled = false
    cameraMutedByInterruption = false
    audioProcessing = args.audioProcessing?.captureOptions ?? AudioCaptureOptions()
    participantVolumes.removeAll()
    screenShareVolumes.removeAll()
    screenShareEnabled = false
    participantCount = 0
    remoteParticipants = []
    removeOverlayViews()
    removeLocalOverlayView()
    connectionState = .connecting
    emitSnapshotChanged()

    // Install all initial per-identity keys before any suspension point so
    // rotation commands are accepted for the entire connecting phase.
    if !keyMaterial.isEmpty {
      keyProvider = Self.makeKeyProvider(keyMaterial: keyMaterial)
    }

    if args.microphoneEnabled {
      let granted = await Self.requestMicrophonePermission()
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      guard granted else {
        failConnect(invoke, error: BridgeError(.permissionDenied))
        return
      }
    }

    // Re-gate audio before connecting: the engine must stay suspended until
    // CallKit grants its audio window.
    callKitController?.suspendEngineUntilActivation()

    // CallKit has to accept the call before connecting; answered calls already did.
    var outgoingCall: UUID?
    if let callerName = args.callerName, let callKitController,
      callKitController.isCallKitAvailable, !callKitController.hasAnsweredCall
    {
      let uuid = UUID()
      let failure = await withCheckedContinuation { continuation in
        callKitController.startOutgoingCall(
          uuid: uuid, callId: args.callId, callerName: callerName
        ) { continuation.resume(returning: $0) }
      }
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      if let failure {
        failConnect(invoke, error: BridgeError(failure))
        return
      }
      outgoingCall = uuid
    }

    // Frame-only E2EE via the legacy options: the newer EncryptionOptions
    // also encrypts data channels, which the web peers do not support.
    let e2eeOptions = keyProvider.map { E2EEOptions(keyProvider: $0) }
    let newRoom = Room(
      delegate: self,
      roomOptions: Self.makeRoomOptions(
        e2eeOptions: e2eeOptions, audioProcessing: audioProcessing))
    room = newRoom

    let connectOptions = Self.buildConnectOptions(from: args)

    do {
      try await newRoom.connect(url: args.url, token: args.token,
                                connectOptions: connectOptions)
    } catch {
      // The thrown error is deliberately discarded: native errors may embed
      // the server URL, and only bounded codes may cross the bridge.
      // failConnect drops this attempt's key provider and index state.
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      await newRoom.disconnect()
      if room === newRoom { room = nil }
      if outgoingCall != nil {
        callKitController?.endCall(callId: args.callId, remoteEnded: true, reason: .failed)
      }
      failConnect(invoke, error: BridgeError(.connectFailed))
      return
    }
    guard attemptId == attempt else {
      await newRoom.disconnect()
      rejectCancelled(invoke)
      return
    }

    // The delegate hop for the connected transition may still be queued; sync
    // from the room so the resolved snapshot is exact (the hop deduplicates).
    applyConnectionState(.connected, from: newRoom)
    if let outgoingCall { callKitController?.reportConnected(uuid: outgoingCall) }

    if args.microphoneEnabled {
      do {
        try await newRoom.localParticipant.setMicrophone(enabled: true)
      } catch {
        guard attemptId == attempt else {
          rejectCancelled(invoke)
          return
        }
        // Partial success: the room stays alive; resolve the connected
        // snapshot with the mic off and a bounded error instead of rejecting.
        lastError = BridgeError(.mediaFailed)
        emitSnapshotChanged()
        invoke.resolve(snapshot())
        return
      }
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      microphoneEnabled = true
      emitSnapshotChanged()
    }

    invoke.resolve(snapshot())
  }

  func disconnect(callId requestedCallId: String, invoke: Invoke) async {
    await teardownMatchingCall(callId: requestedCallId, invoke: invoke)
  }

  /// Rust-side timeout recovery: identical teardown semantics to
  /// `disconnect` for the matching (possibly in-flight) attempt.
  func cancelConnect(callId requestedCallId: String, invoke: Invoke) async {
    await teardownMatchingCall(callId: requestedCallId, invoke: invoke)
  }

  func setMicrophoneEnabled(
    callId requestedCallId: String, enabled: Bool, invoke: Invoke
  ) async {
    guard callId == requestedCallId, let room else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }

    attempt &+= 1
    let attemptId = attempt

    if enabled {
      let granted = await Self.requestMicrophonePermission()
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      guard granted else {
        lastError = BridgeError(.permissionDenied)
        emitSnapshotChanged()
        reject(invoke, .permissionDenied)
        return
      }
    }

    do {
      try await room.localParticipant.setMicrophone(enabled: enabled)
    } catch {
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      lastError = BridgeError(.mediaFailed)
      emitSnapshotChanged()
      reject(invoke, .mediaFailed)
      return
    }
    guard attemptId == attempt else {
      rejectCancelled(invoke)
      return
    }

    microphoneEnabled = enabled
    // Push mute state back to CallKit so the system UI stays consistent.
    if let callId {
      callKitController?.setMuted(!enabled, for: callId)
    }
    emitSnapshotChanged()
    invoke.resolve(snapshot())
  }

  /// Records the processing for later captures and pushes it to a live
  /// microphone track. `setAudioProcessingOptions` throws only when the track
  /// cannot take them, which is the one case that reports a media failure.
  func setAudioProcessing(
    callId requestedCallId: String, processing: AudioCaptureOptions, invoke: Invoke
  ) async {
    guard callId == requestedCallId else {
      invoke.resolve(snapshot())
      return
    }
    audioProcessing = processing
    let publication = room?.localParticipant.trackPublications.values
      .first(where: { $0.source == .microphone })
    if let track = publication?.track as? LocalAudioTrack {
      do {
        _ = try track.setAudioProcessingOptions(
          AudioProcessingOptions(
            echoCancellation: processing.echoCancellation,
            autoGainControl: processing.autoGainControl,
            noiseSuppression: processing.noiseSuppression))
      } catch {
        lastError = BridgeError(.mediaFailed)
        emitSnapshotChanged()
        reject(invoke, .mediaFailed)
        return
      }
    }
    invoke.resolve(snapshot())
  }

  func setParticipantVolume(
    callId requestedCallId: String, identity: String, volume: Double,
    screenShare: Bool, invoke: Invoke
  ) async {
    guard callId == requestedCallId else {
      invoke.resolve(snapshot())
      return
    }
    if screenShare {
      screenShareVolumes[identity] = volume
    } else {
      participantVolumes[identity] = volume
    }
    applyParticipantVolumes()
    invoke.resolve(snapshot())
  }

  private func applyParticipantVolumes() {
    guard let room else { return }
    for (identity, participant) in room.remoteParticipants {
      for publication in participant.trackPublications.values
      where publication.source == .microphone || publication.source == .screenShareAudio {
        let screen = publication.source == .screenShareAudio
        let volume = screen
          ? (screenShareVolumes[identity.stringValue] ?? 0)
          : (participantVolumes[identity.stringValue] ?? 1)
        (publication.track as? RemoteAudioTrack)?.volume = volume
      }
    }
  }

  func setCameraEnabled(
    callId requestedCallId: String, enabled: Bool, invoke: Invoke
  ) async {
    guard callId == requestedCallId, let room else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }

    attempt &+= 1
    let attemptId = attempt

    if enabled {
      let granted = await Self.requestCameraPermission()
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      guard granted else {
        lastError = BridgeError(.permissionDenied)
        emitSnapshotChanged()
        reject(invoke, .permissionDenied)
        return
      }
    }

    do {
      try await room.localParticipant.setCamera(enabled: enabled)
      if !enabled, let publication = Self.cameraPublication(in: room) {
        // Stopping capture alone can keep the hardware session alive;
        // unpublishing guarantees the camera is released.
        try await room.localParticipant.unpublish(publication: publication)
      }
    } catch {
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      lastError = BridgeError(.mediaFailed)
      emitSnapshotChanged()
      reject(invoke, .mediaFailed)
      return
    }
    guard attemptId == attempt else {
      rejectCancelled(invoke)
      return
    }

    cameraEnabled = enabled
    callKitController?.setCameraActive(enabled)

    if enabled { Self.enableMultitaskingCameraAccess(in: room) }

    emitSnapshotChanged()
    invoke.resolve(snapshot())
  }

  func switchCamera(callId requestedCallId: String, invoke: Invoke) async {
    guard callId == requestedCallId, let room else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }

    attempt &+= 1
    let attemptId = attempt

    guard let capturer = Self.cameraCapturer(in: room) else {
      // Nothing to toggle until the camera is publishing.
      reject(invoke, .invalidRequest)
      return
    }

    do {
      try await capturer.switchCameraPosition()
    } catch {
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      lastError = BridgeError(.mediaFailed)
      emitSnapshotChanged()
      reject(invoke, .mediaFailed)
      return
    }
    guard attemptId == attempt else {
      rejectCancelled(invoke)
      return
    }

    // The camera position is intentionally not part of the snapshot.
    invoke.resolve(snapshot())
  }

  func setScreenShareEnabled(
    callId requestedCallId: String, enabled: Bool, invoke: Invoke
  ) async {
    guard callId == requestedCallId, let room else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }

    attempt &+= 1
    let attemptId = attempt

    do {
      try await room.localParticipant.setScreenShare(enabled: enabled)
    } catch {
      guard attemptId == attempt else {
        rejectCancelled(invoke)
        return
      }
      lastError = BridgeError(.mediaFailed)
      emitSnapshotChanged()
      reject(invoke, .mediaFailed)
      return
    }
    guard attemptId == attempt else {
      rejectCancelled(invoke)
      return
    }

    screenShareEnabled = enabled
    emitSnapshotChanged()
    invoke.resolve(snapshot())
  }

  // MARK: - E2EE key rotation

  /// Installs rotated key material for one participant identity. The input
  /// is validated first, matching the other lanes: invalid decoded input
  /// rejects `invalid_request` regardless of call state. A stale call id or
  /// a current call without an E2EE provider (unencrypted call, failed
  /// attempt) resolves the unchanged snapshot; the provider exists exactly
  /// while an attempt is connecting, connected, or reconnecting, so those
  /// all accept updates. Every key is installed at the index the sender used:
  /// an index selects a slot in that identity's key ring and the sender writes
  /// it into each frame, and indexes are not monotonic because a peer that
  /// rejoins restarts its outbound session at 0, so filtering by index would
  /// strand every frame that peer sends afterwards. Deliberately emits no
  /// snapshot event
  /// and bumps no revision: key state is not part of the bridge contract
  /// and must remain invisible.
  func setEncryptionKey(
    callId requestedCallId: String, identity: String, keyIndex: Int32,
    key: String, invoke: Invoke
  ) {
    guard let material = Self.decodeKey(
      identity: identity, keyIndex: keyIndex, key: key)
    else {
      reject(invoke, .invalidRequest)
      return
    }
    guard callId == requestedCallId, let keyProvider else {
      invoke.resolve(snapshot())
      return
    }
    keyProvider.setKey(
      keyData: material.keyData, participantId: material.identity,
      index: material.keyIndex)
    invoke.resolve(snapshot())
  }

  /// Decoded per-participant key material for one call attempt.
  struct EncryptionKeyMaterial {
    let identity: String
    let keyIndex: Int32
    let keyData: Data
  }

  /// Validates and decodes one wire entry, matching the Rust gate and the
  /// Android lane: blank (empty or whitespace-only) identities, negative
  /// indexes, undecodable base64, and empty decoded key bytes are all
  /// invalid. Key material is never logged.
  nonisolated static func decodeKey(
    identity: String, keyIndex: Int32, key: String
  ) -> EncryptionKeyMaterial? {
    guard !identity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      keyIndex >= 0,
      let keyData = Data(base64Encoded: key), !keyData.isEmpty
    else { return nil }
    return EncryptionKeyMaterial(
      identity: identity, keyIndex: keyIndex, keyData: keyData)
  }

  /// Decodes optional base64 key payloads. Returns nil when any entry is
  /// undecodable (the caller rejects via the bounded invalid-request path),
  /// an empty array when the payload is absent or empty (unencrypted call).
  nonisolated static func decodeKeyMaterial(
    from payloads: [EncryptionKeyPayload]?
  ) -> [EncryptionKeyMaterial]? {
    guard let payloads, !payloads.isEmpty else { return [] }
    var material: [EncryptionKeyMaterial] = []
    material.reserveCapacity(payloads.count)
    for payload in payloads {
      guard
        let entry = Self.decodeKey(
          identity: payload.identity, keyIndex: payload.keyIndex, key: payload.key)
      else { return nil }
      material.append(entry)
    }
    return material
  }

  /// Builds the per-call key provider matching the web lanes: per-participant
  /// keys (no shared key), HKDF derivation, ratchet window 10, key ring 256;
  /// the ratchet salt and uncrypted magic bytes keep the LiveKit defaults.
  nonisolated static func makeKeyProvider(
    keyMaterial: [EncryptionKeyMaterial]
  ) -> BaseKeyProvider {
    let provider = BaseKeyProvider(
      options: KeyProviderOptions(
        sharedKey: false,
        ratchetWindowSize: 10,
        keyRingSize: 256,
        keyDerivationAlgorithm: .hkdf))
    for key in keyMaterial {
      provider.setKey(
        keyData: key.keyData, participantId: key.identity, index: key.keyIndex)
    }
    return provider
  }

  /// The room options for every attempt, encrypted or not: the SDK defaults
  /// leave adaptive stream and dynacast off, and would suspend the local
  /// camera as soon as the app backgrounds, which freezes the video in PiP.
  nonisolated static func makeRoomOptions(
    e2eeOptions: E2EEOptions?, audioProcessing: AudioCaptureOptions
  ) -> RoomOptions {
    RoomOptions(
      defaultAudioCaptureOptions: audioProcessing,
      defaultAudioPublishOptions: AudioPublishOptions(red: e2eeOptions == nil),
      adaptiveStream: true, dynacast: true,
      suspendLocalVideoTracksInBackground: false,
      e2eeOptions: e2eeOptions,
      singlePeerConnection: true)
  }

  /// Builds ``ConnectOptions`` from optional connect-args fields. Returns nil
  /// when both `iceServers` and `reconnectAttempts` are absent: the
  /// default-initialised ``ConnectOptions`` is equivalent and avoids an
  /// allocation.
  nonisolated static func buildConnectOptions(
    from args: ConnectArgs
  ) -> ConnectOptions? {
    let ice = args.iceServers?.compactMap { s -> IceServer? in
      let urls = s.urls.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
      guard !urls.isEmpty else { return nil }
      let username = s.username.flatMap { $0.isEmpty ? nil : $0 }
      let credential = s.credential.flatMap { $0.isEmpty ? nil : $0 }
      return IceServer(urls: urls, username: username, credential: credential)
    }
    let hasIce = ice.flatMap { !$0.isEmpty } ?? false
    let hasReconn = args.reconnectAttempts != nil
    guard hasIce || hasReconn else { return nil }

    if let attempts = args.reconnectAttempts {
      return ConnectOptions(
        reconnectAttempts: max(attempts, 0),
        iceServers: ice ?? [])
    }
    return ConnectOptions(iceServers: ice ?? [])
  }

  // MARK: - Remote video overlay

  /// Attaches the track's non-interactive `VideoView` to the resolved remote
  /// video track and positions it over the matching DOM rect. `frame` is the
  /// viewport-relative CSS rect: CSS pixels map 1:1 to iOS logical points, so
  /// it is converted into the webview's superview coordinate space via
  /// `UIView.convert` and clipped to the webview's bounds. `devicePixelRatio`
  /// is validated but intentionally never applied on iOS.
  ///
  /// A call for the same track with a new rect only repositions the view. A
  /// missing or replaced track (unpublished/unsubscribed between the snapshot
  /// the caller acted on and this command) clears the attachment safely and
  /// still resolves the current snapshot; the selection is kept so a later
  /// track event can rebind it.
  func setRemoteVideoOverlay(
    callId requestedCallId: String,
    participantIdentity: String,
    trackSid: String,
    frame: CGRect,
    devicePixelRatio: Double,
    invoke: Invoke
  ) {
    guard callId == requestedCallId, let room else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }
    // The shared lane already bounds the geometry; mirror the bound here so
    // the native side is safe on its own. Partially off-screen tiles are
    // legal, so x/y only need to be finite; size and pixel ratio must be
    // positive.
    guard Self.overlayGeometryIsValid(frame, devicePixelRatio: devicePixelRatio)
    else {
      reject(invoke, .invalidRequest)
      return
    }
    guard let webView = hostWebView, let container = webView.superview else {
      reject(invoke, .unavailable)
      return
    }
    guard let clipped = Self.overlayFrame(
      viewportRect: frame, in: webView, container: container)
    else {
      // The tile is entirely outside the visible webview area.
      reject(invoke, .invalidRequest)
      return
    }

    let view = ensureOverlayView(
      for: OverlaySelection(participantIdentity: participantIdentity, trackSid: trackSid),
      above: webView, in: container)

    guard
      let track = Self.remoteVideoTrack(
        participantIdentity: participantIdentity, trackSid: trackSid, in: room)
    else {
      // Clears safely: detach without failing the command.
      detachOverlay(from: view)
      if #available(iOS 15.0, *) { refreshPiP() }
      invoke.resolve(snapshot())
      return
    }

    if view.track !== track {
      view.track = track
    }
    view.layoutMode = Self.overlayLayoutMode(for: track)
    view.frame = clipped
    view.isHidden = false
    if #available(iOS 15.0, *) { refreshPiP() }
    invoke.resolve(snapshot())
  }

  /// A shared screen is letterboxed: `VideoView` defaults to `.fill`, which
  /// cuts the sides off a desktop shown in a portrait slot. Cameras keep
  /// `.fill`, where covering the tile is what you want.
  nonisolated static func overlayLayoutMode(for track: VideoTrack) -> VideoView.LayoutMode {
    track.source == .screenShareVideo ? .fit : .fill
  }

  /// Removes the overlay view of `trackSid`, or all of them when nil. A stale
  /// call id is a no-op resolve, matching the other call-scoped commands.
  func clearRemoteVideoOverlay(
    callId requestedCallId: String, trackSid: String?, invoke: Invoke
  ) {
    guard callId == requestedCallId else {
      invoke.resolve(snapshot())
      return
    }
    if let trackSid {
      removeOverlayView(trackSid: trackSid)
    } else {
      removeOverlayViews()
    }
    if #available(iOS 15.0, *) { refreshPiP() }
    invoke.resolve(snapshot())
  }

  /// Returns the track's overlay view, creating it as a non-interactive
  /// sibling directly above the host webview on first use.
  private func ensureOverlayView(
    for selection: OverlaySelection, above webView: UIView, in container: UIView
  ) -> VideoView {
    if let index = remoteOverlays.firstIndex(where: {
      $0.selection.trackSid == selection.trackSid
    }) {
      remoteOverlays[index].selection = selection
      let view = remoteOverlays[index].view
      if view.superview !== container {
        view.removeFromSuperview()
        container.insertSubview(view, aboveSubview: webView)
      }
      return view
    }
    let view = VideoView()
    // The web content keeps all interaction; the overlay must not intercept
    // touches meant for the WebView's controls.
    view.isUserInteractionEnabled = false
    view.isHidden = true
    container.insertSubview(view, aboveSubview: webView)
    remoteOverlays.append(RemoteOverlay(selection: selection, view: view))
    return view
  }

  /// Detaches the renderer but keeps the (hidden) view for the next bind.
  private func detachOverlay(from view: VideoView) {
    view.track = nil
    view.isHidden = true
  }

  /// Fully releases an overlay (clear, disconnect, teardown, attempt
  /// replacement): detach the track first so `VideoView` drops its renderer
  /// subscriptions, then hide and remove from the hierarchy. A later set
  /// recreates the view cleanly.
  private func releaseOverlay(_ view: VideoView) {
    view.track = nil
    view.isHidden = true
    view.removeFromSuperview()
  }

  private func removeOverlayView(trackSid: String) {
    guard let index = remoteOverlays.firstIndex(where: { $0.selection.trackSid == trackSid })
    else { return }
    releaseOverlay(remoteOverlays.remove(at: index).view)
  }

  private func removeOverlayViews() {
    let removed = remoteOverlays
    remoteOverlays = []
    removed.forEach { releaseOverlay($0.view) }
  }

  /// Re-resolves every selected overlay track after participant/track
  /// lifecycle events: rebinds to the (possibly replaced) live track, or
  /// clears the attachment when the track is gone (unpublish, unsubscribe, or
  /// the participant left). Never recreates a removed view.
  private func reconcileOverlay(in room: Room) {
    guard !remoteOverlays.isEmpty else { return }
    for overlay in remoteOverlays {
      let view = overlay.view
      guard
        let track = Self.remoteVideoTrack(
          participantIdentity: overlay.selection.participantIdentity,
          trackSid: overlay.selection.trackSid, in: room)
      else {
        detachOverlay(from: view)
        continue
      }
      if view.track !== track {
        view.track = track
      }
      view.layoutMode = Self.overlayLayoutMode(for: track)
      view.isHidden = false
    }
    if #available(iOS 15.0, *) { refreshPiP() }
  }

  /// Bounds for the overlay rect and pixel ratio. Tiles may be partially
  /// off-screen, so the origin only needs to be finite; the size and the
  /// pixel ratio must be finite and positive. The raw `size` is inspected:
  /// `CGRect.width`/`height` normalize away negative sizes.
  nonisolated static func overlayGeometryIsValid(
    _ rect: CGRect, devicePixelRatio: Double
  ) -> Bool {
    rect.minX.isFinite && rect.minY.isFinite
      && rect.size.width.isFinite && rect.size.height.isFinite
      && rect.size.width > 0 && rect.size.height > 0
      && devicePixelRatio.isFinite && devicePixelRatio > 0
  }

  /// Maps the viewport-relative CSS rect into the webview's superview
  /// coordinate space (via the view hierarchy, so transforms are honored) and
  /// clips it to the webview's own bounds. Nil when the intersection is
  /// empty; the device's pixel ratio is intentionally not applied because
  /// CSS pixels already map 1:1 to logical points. MainActor-isolated with
  /// the rest of the controller: UIView geometry is main-thread state.
  static func overlayFrame(
    viewportRect: CGRect, in webView: UIView, container: UIView
  ) -> CGRect? {
    let converted = webView.convert(viewportRect, to: container)
    let hostBounds = webView.convert(webView.bounds, to: container)
    let clipped = converted.intersection(hostBounds)
    // `isEmpty` covers null/infinite rects and non-positive dimensions.
    guard !clipped.isNull, !clipped.isEmpty else { return nil }
    return clipped
  }

  /// Resolves one remote participant's video track by identity plus track
  /// SID; nil when the participant or the publication is gone, when the
  /// publication is unsubscribed (so an unsubscribe detaches the overlay
  /// immediately), or when it carries no video track.
  nonisolated static func remoteVideoTrack(
    participantIdentity: String, trackSid: String, in room: Room
  ) -> VideoTrack? {
    guard
      let participant = room.remoteParticipants.first(where: {
        $0.key.stringValue == participantIdentity
      })?.value,
      let publication = participant.trackPublications.values
        .first(where: { $0.sid.stringValue == trackSid }),
      publication.isSubscribed,
      let track = publication.track as? VideoTrack
    else { return nil }
    return track
  }

  // MARK: - Local camera preview overlay

  /// Attaches a second, independent `VideoView` to the local camera track
  /// and positions it over the matching DOM rect. The local camera track is
  /// resolved internally (there is at most one camera track per room). The
  /// view is mirrored (selfie preview). Same geometry validation and clipping
  /// as the remote overlay.
  func setLocalVideoOverlay(
    callId requestedCallId: String,
    frame: CGRect,
    devicePixelRatio: Double,
    invoke: Invoke
  ) {
    guard callId == requestedCallId, let room else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }
    guard Self.overlayGeometryIsValid(frame, devicePixelRatio: devicePixelRatio) else {
      reject(invoke, .invalidRequest)
      return
    }
    guard let webView = hostWebView, let container = webView.superview else {
      reject(invoke, .unavailable)
      return
    }
    guard let clipped = Self.overlayFrame(
      viewportRect: frame, in: webView, container: container)
    else {
      reject(invoke, .invalidRequest)
      return
    }

    let view = ensureLocalOverlayView(in: container)

    guard
      let publication = Self.cameraPublication(in: room),
      let track = publication.track as? VideoTrack
    else {
      detachLocalOverlay(from: view)
      invoke.resolve(snapshot())
      return
    }

    if view.track !== track {
      view.track = track
    }
    view.frame = clipped
    view.isHidden = false
    invoke.resolve(snapshot())
  }

  /// Removes the local overlay view. A stale call id is a no-op resolve.
  func clearLocalVideoOverlay(callId requestedCallId: String, invoke: Invoke) {
    guard callId == requestedCallId else {
      invoke.resolve(snapshot())
      return
    }
    removeLocalOverlayView()
    invoke.resolve(snapshot())
  }

  /// Returns the single local overlay view, creating it as a non-interactive,
  /// mirrored sibling of the host webview on first use.
  private func ensureLocalOverlayView(in container: UIView) -> VideoView {
    if let localOverlayView {
      if localOverlayView.superview !== container {
        localOverlayView.removeFromSuperview()
        container.addSubview(localOverlayView)
      }
      return localOverlayView
    }
    let view = VideoView()
    view.isUserInteractionEnabled = false
    view.isHidden = true
    view.mirrorMode = .auto
    container.addSubview(view)
    localOverlayView = view
    return view
  }

  /// Detaches the local renderer but keeps the (hidden) view.
  private func detachLocalOverlay(from view: VideoView) {
    view.track = nil
    view.isHidden = true
  }

  /// Fully releases the local overlay: detach, hide, remove from hierarchy,
  /// drop the reference.
  private func removeLocalOverlayView() {
    guard let view = localOverlayView else { return }
    view.track = nil
    view.isHidden = true
    view.removeFromSuperview()
    localOverlayView = nil
  }

  /// Re-resolves the local camera track after track lifecycle events:
  /// rebinds to the (possibly replaced) live track, or clears the attachment
  /// when the track is gone. Never recreates a removed view.
  private func reconcileLocalOverlay(in room: Room) {
    guard let view = localOverlayView else { return }
    guard
      let publication = Self.cameraPublication(in: room),
      let track = publication.track as? VideoTrack
    else {
      detachLocalOverlay(from: view)
      return
    }
    if view.track !== track {
      view.track = track
    }
    view.isHidden = false
  }

  /// Silent teardown for plugin deinit; bumps the attempt identity so
  /// in-flight work settles with `cancelled`.
  func tearDown() async {
    attempt &+= 1
    pipEnabled = false
    let roomToClose = room
    room = nil
    channel = nil
    if let callId { callKitController?.endCall(callId: callId, remoteEnded: true) }
    callId = nil
    connectionState = .idle
    microphoneEnabled = false
    cameraEnabled = false
    cameraMutedByInterruption = false
    screenShareEnabled = false
    callKitController?.setCameraActive(false)
    participantCount = 0
    remoteParticipants = []
    keyProvider = nil
    lastError = nil
    localConnectionQuality = nil
    removeOverlayViews()
    removeLocalOverlayView()
    if #available(iOS 15.0, *) { stopPiP() }
    if let roomToClose {
      await roomToClose.disconnect()
    }
  }

  // MARK: - Native Picture-in-Picture (iOS 15+)

  /// Enables or disables native PiP for the current call. Arming needs a bound
  /// overlay track, which the lane usually only creates after this call, so
  /// the request is recorded and `refreshPiP` arms it as soon as the overlay
  /// binds. The controller's `canStartPictureInPictureAutomaticallyFromInline`
  /// flag lets the system auto-start PiP when the app backgrounds.
  func setNativeCallPiPEnabled(callId requestedCallId: String, enabled: Bool, invoke: Invoke) {
    guard callId == requestedCallId, room != nil else {
      invoke.resolve(snapshot())
      return
    }
    guard connectionState == .connected else {
      reject(invoke, .invalidRequest)
      return
    }

    pipEnabled = enabled
    if #available(iOS 15.0, *) {
      refreshPiP()
      if enabled, UIApplication.shared.applicationState == .background,
        let ctrl = pipController as? AVPictureInPictureController,
        ctrl.isPictureInPicturePossible
      {
        ctrl.startPictureInPicture()
      }
    }

    invoke.resolve(snapshot())
  }

  // MARK: PiP controller lifecycle (private)

  private var pipSourceView: VideoView? {
    let bound = remoteOverlays.map(\.view).filter { $0.track != nil }
    return bound.first { $0.track?.source == .screenShareVideo } ?? bound.first
  }

  /// Arms, rebinds or releases PiP against the current overlay binding. Called
  /// whenever `pipEnabled` or an overlay's track changes.
  @available(iOS 15.0, *)
  private func refreshPiP() {
    guard pipEnabled, let sourceView = pipSourceView, let track = sourceView.track
    else {
      stopPiP()
      return
    }
    guard let vc = pipViewController as? PiPVideoCallViewController,
      let controller = pipController as? AVPictureInPictureController
    else {
      armPiP(sourceView: sourceView, track: track)
      return
    }
    if controller.contentSource?.activeVideoCallSourceView !== sourceView {
      controller.contentSource = AVPictureInPictureController.ContentSource(
        activeVideoCallSourceView: sourceView, contentViewController: vc)
    }
    guard pipTrack !== track else { return }
    pipTrack?.remove(videoRenderer: vc)
    track.add(videoRenderer: vc)
    pipTrack = track
  }

  /// Builds the PiP controller over its own renderer. The on-screen overlay is
  /// only handed over as the `activeVideoCallSourceView`, so the in-app tile
  /// keeps rendering untouched.
  @available(iOS 15.0, *)
  private func armPiP(sourceView: VideoView, track: VideoTrack) {
    guard AVPictureInPictureController.isPictureInPictureSupported() else { return }

    let vc = PiPVideoCallViewController()
    // Drives the PiP window's aspect ratio until the first frame refines it.
    if let dimensions = track.dimensions {
      vc.preferredContentSize = CGSize(
        width: CGFloat(dimensions.width), height: CGFloat(dimensions.height))
    }
    track.add(videoRenderer: vc)

    let source = AVPictureInPictureController.ContentSource(
      activeVideoCallSourceView: sourceView, contentViewController: vc)
    let controller = AVPictureInPictureController(contentSource: source)
    controller.canStartPictureInPictureAutomaticallyFromInline = true
    controller.delegate = self
    pipController = controller
    pipViewController = vc
    pipTrack = track
    logRoom("PiP armed (auto-start on background)")
  }

  /// Stops active PiP and releases the controller. An active PiP window is
  /// dismissed with an animation, so the release is handed off to the stop
  /// callback rather than pulling the renderer out mid-animation.
  @available(iOS 15.0, *)
  private func stopPiP() {
    guard let ctrl = pipController as? AVPictureInPictureController else { return }
    if ctrl.isPictureInPictureActive {
      ctrl.stopPictureInPicture()
      return
    }
    releasePiP()
  }

  /// Unregisters the PiP renderer from its track and drops the view controller
  /// and controller.
  private func releasePiP() {
    if #available(iOS 15.0, *),
      let vc = pipViewController as? PiPVideoCallViewController
    {
      pipTrack?.remove(videoRenderer: vc)
    }
    pipTrack = nil
    pipViewController = nil
    pipController = nil
    logRoom("PiP released")
  }

  // MARK: - Shared helpers (main actor)

  /// Tears down the matching attempt, emits the final idle snapshot on its
  /// outgoing channel, and resolves. A stale call id is a no-op resolve: it
  /// must never tear down a newer call that reused this controller.
  private func teardownMatchingCall(
    callId requestedCallId: String, invoke: Invoke
  ) async {
    guard callId == requestedCallId else {
      invoke.resolve(snapshot())
      return
    }
    await clearCurrentCall(endSystemCall: true)
    invoke.resolve(snapshot())
  }

  /// Native teardown for a CallKit end action the system raised itself (a
  /// lock-screen decline, the system call UI's end button). The CX call is
  /// already ending, so `endSystemCall` is false: re-entering `endCall` would
  /// race the action's own fulfillment.
  func tearDownForSystemEnd(callId requestedCallId: String) async {
    guard callId == requestedCallId else { return }
    await clearCurrentCall(endSystemCall: false)
  }

  /// Tears the current attempt down, emits the final idle snapshot on its
  /// outgoing channel, and closes the room.
  private func clearCurrentCall(endSystemCall: Bool) async {
    attempt &+= 1
    pipEnabled = false

    let roomToClose = room
    room = nil
    connectionState = .idle
    microphoneEnabled = false
    cameraEnabled = false
    cameraMutedByInterruption = false
    screenShareEnabled = false
    callKitController?.setCameraActive(false)
    participantCount = 0
    remoteParticipants = []
    keyProvider = nil
    lastError = nil
    localConnectionQuality = nil
    if endSystemCall, let callId {
      callKitController?.endCall(callId: callId, remoteEnded: false)
    }
    callId = nil
    removeOverlayViews()
    removeLocalOverlayView()
    if #available(iOS 15.0, *) { stopPiP() }
    emitSnapshotChanged()
    channel = nil

    if let roomToClose {
      await roomToClose.disconnect()
    }
    callKitController?.refreshRegion()
  }

  private func applyConnectionState(
    _ newState: BridgeConnectionState, from room: Room? = nil
  ) {
    guard connectionState != newState else { return }
    connectionState = newState
    if newState == .connected, let room {
      microphoneEnabled = room.localParticipant.isMicrophoneEnabled()
      cameraEnabled = room.localParticipant.isCameraEnabled()
      screenShareEnabled = room.localParticipant.isScreenShareEnabled()
      remoteParticipants = Self.projectRemoteParticipants(in: room)
      participantCount = remoteParticipants.count
    }
    emitSnapshotChanged()
  }

  private func failConnect(_ invoke: Invoke, error: BridgeError) {
    connectionState = .failed
    microphoneEnabled = false
    cameraEnabled = false
    cameraMutedByInterruption = false
    screenShareEnabled = false
    participantCount = 0
    remoteParticipants = []
    keyProvider = nil
    lastError = error
    localConnectionQuality = nil
    emitSnapshotChanged()
    invoke.reject(error.message, code: error.code.rawValue)
  }

  private func reject(_ invoke: Invoke, _ code: BridgeFailureCode) {
    invoke.reject(code.message, code: code.rawValue)
  }

  private func rejectCancelled(_ invoke: Invoke) {
    reject(invoke, .cancelled)
  }

  // MARK: - Remote participant projection

  /// Minimal remote-only projection: identity (from the room's participant
  /// key) plus the camera, screen-share and microphone publications with
  /// remote-aware mute/subscription state. Sorted by identity so the snapshot
  /// is stable.
  nonisolated static func projectRemoteParticipants(
    in room: Room
  ) -> [BridgeRemoteParticipant] {
    room.remoteParticipants
      .map { identity, participant in
        let camera =
          participant.trackPublications.values
          .filter { $0.source == .camera }
          .sorted { $0.sid.stringValue < $1.sid.stringValue }
          .first
          .map {
            BridgeRemoteCamera(
              sid: $0.sid.stringValue, muted: $0.isMuted,
              subscribed: $0.isSubscribed)
          }
        let screenShare =
          participant.trackPublications.values
          .filter { $0.source == .screenShareVideo }
          .sorted { $0.sid.stringValue < $1.sid.stringValue }
          .first
          .map {
            BridgeRemoteScreenShare(
              sid: $0.sid.stringValue, muted: $0.isMuted,
              subscribed: $0.isSubscribed)
          }
        let microphone =
          participant.trackPublications.values
          .filter { $0.source == .microphone }
          .sorted { $0.sid.stringValue < $1.sid.stringValue }
          .first
          .map {
            BridgeRemoteMicrophone(
              sid: $0.sid.stringValue, muted: $0.isMuted,
              subscribed: $0.isSubscribed)
          }
        let screenShareAudio =
          participant.trackPublications.values
          .filter { $0.source == .screenShareAudio }
          .sorted { $0.sid.stringValue < $1.sid.stringValue }
          .first
          .map {
            BridgeRemoteMicrophone(
              sid: $0.sid.stringValue, muted: $0.isMuted,
              subscribed: $0.isSubscribed)
          }
        return BridgeRemoteParticipant(
          identity: identity.stringValue, camera: camera,
          screenShare: screenShare,
          screenShareAudio: screenShareAudio,
          microphone: microphone,
          connectionQuality: Self.connectionQualityWire(participant.connectionQuality))
      }
      .sorted { $0.identity < $1.identity }
  }

  /// Extracts a human-readable room name from a LiveKit URL for CallKit
  /// caller-id display. Takes the last path component (after the final `/`).
  nonisolated static func roomName(from url: String) -> String {
    guard let parsed = URL(string: url) else { return "Call" }
    let name = parsed.lastPathComponent
    return name.isEmpty ? "Call" : name
  }

  // MARK: - Camera helpers

  /// The published camera publication if any; identified by track source via
  /// the public local video list.
  nonisolated static func cameraPublication(in room: Room) -> LocalTrackPublication? {
    room.localParticipant.localVideoTracks.first(where: { $0.source == .camera })
  }

  /// The capturer behind the published camera track, which owns the real
  /// `AVCaptureSession`.
  nonisolated static func cameraCapturer(in room: Room) -> CameraCapturer? {
    guard
      let publication = cameraPublication(in: room),
      let track = publication.track as? LocalVideoTrack
    else { return nil }
    return track.capturer as? CameraCapturer
  }

  /// Lets the camera keep capturing while the app is not the only foreground
  /// app, which is what PiP is. The capturer reports it unsupported below
  /// iOS 16, where the setter is a no-op.
  nonisolated static func enableMultitaskingCameraAccess(in room: Room) {
    guard let capturer = cameraCapturer(in: room),
      capturer.isMultitaskingAccessSupported
    else { return }
    capturer.isMultitaskingAccessEnabled = true
    logRoom("Multitasking camera access enabled")
  }

  /// The interruption reasons that mean the camera is genuinely unusable for
  /// the duration: the screen locked or the app backgrounded, another session
  /// took the device, or multitasking camera access was refused.
  ///
  /// `audioDeviceInUseByAnotherClient` says nothing about the camera and fires
  /// on ordinary audio contention, so acting on it muted the local video at
  /// call start. `videoDeviceNotAvailableDueToSystemPressure` is left out too:
  /// AVFoundation lifts it once thermal duress eases, and muting restarts the
  /// capture session on unmute, which is the opposite of what a device under
  /// pressure needs. Anything else, including reasons added by a future iOS,
  /// is ignored rather than guessed at.
  nonisolated static func interruptionStopsCamera(
    _ reason: AVCaptureSession.InterruptionReason
  ) -> Bool {
    switch reason {
    case .videoDeviceNotAvailableInBackground, .videoDeviceInUseByAnotherClient,
      .videoDeviceNotAvailableWithMultipleForegroundApps:
      return true
    default:
      return false
    }
  }

  /// The camera capture session was interrupted. The notification is posted on
  /// an arbitrary thread, so the work hops onto the main actor with the rest of
  /// the state. It is also posted for every `AVCaptureSession` in the process
  /// and for audio-only outages, so the reason is decoded into its enum and
  /// filtered before anything is muted.
  @objc private nonisolated func handleCaptureSessionInterruption(
    _ notification: Notification
  ) {
    guard
      let raw = notification.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int,
      let reason = AVCaptureSession.InterruptionReason(rawValue: raw)
    else { return }
    guard Self.interruptionStopsCamera(reason) else {
      logRoom("Camera capture session interrupted, ignored: reason=\(raw)")
      return
    }
    Task { @MainActor [weak self] in
      await self?.muteCameraForInterruption(reason: reason)
    }
  }

  /// The interruption ended while the session was still the system's to
  /// resume, which is the case whenever the app kept running in the
  /// foreground (another app gave the camera back, system pressure eased).
  @objc private nonisolated func handleCaptureSessionInterruptionEnded() {
    Task { @MainActor [weak self] in
      await self?.restoreCameraAfterInterruption()
    }
  }

  /// The second restore trigger, and the only one for a locked screen. Muting
  /// a local video track stops its capture session, and AVFoundation only
  /// preserves the pending `startRunning` (and therefore only posts
  /// `interruptionEndedNotification`) for a backgrounded session that was
  /// never explicitly stopped, per the
  /// `AVCaptureSessionInterruptionReasonVideoDeviceNotAvailableInBackground`
  /// documentation. Becoming active again is what tells us the camera is
  /// usable once more.
  @objc private nonisolated func handleApplicationDidBecomeActive() {
    Task { @MainActor [weak self] in
      await self?.restoreCameraAfterInterruption()
    }
  }

  /// Mutes the interrupted camera so remote peers render the participant as
  /// camera-off instead of the last captured frame, which they would otherwise
  /// keep showing for the whole interruption. CallKit is deliberately left
  /// alone: `setCameraActive(false)` re-applies the `.voiceChat` audio mode and
  /// would move a still-video call from the speaker to the earpiece over a
  /// transient camera outage.
  private func muteCameraForInterruption(
    reason: AVCaptureSession.InterruptionReason
  ) async {
    logRoom("Camera capture session interrupted: reason=\(reason.rawValue)")
    // `videoDeviceNotAvailableInBackground` describes a session interrupted
    // because its app is no longer in the foreground, so the same reason while
    // the app is active cannot be about the camera this call publishes.
    if reason == .videoDeviceNotAvailableInBackground,
      UIApplication.shared.applicationState == .active
    {
      return
    }
    guard cameraEnabled, !cameraMutedByInterruption, let room,
      let publication = Self.cameraPublication(in: room)
    else { return }

    let attemptId = attempt
    do {
      try await publication.mute()
    } catch {
      logRoom("Failed to mute the interrupted camera")
      return
    }
    // Not an attempt of its own: a background event must not cancel the
    // in-flight command lane, only stand down when one has moved on.
    guard attemptId == attempt, room === self.room else { return }

    cameraMutedByInterruption = true
    cameraEnabled = false
    emitSnapshotChanged()
  }

  /// Unmutes only a camera this controller muted itself, so a user who had the
  /// camera off keeps it off. Unmuting restarts the capture session that
  /// muting stopped. Any other state (no call, the camera unpublished or
  /// already unmuted meanwhile) means the recorded mute no longer describes
  /// anything and is forgotten.
  private func restoreCameraAfterInterruption() async {
    guard cameraMutedByInterruption, let room,
      let publication = Self.cameraPublication(in: room), publication.isMuted
    else {
      cameraMutedByInterruption = false
      return
    }

    let attemptId = attempt
    do {
      try await publication.unmute()
    } catch {
      logRoom("Failed to restore the camera after the interruption")
      return
    }
    guard attemptId == attempt, room === self.room else { return }

    cameraMutedByInterruption = false
    cameraEnabled = true
    // The capturer reconfigures its session on restart, so re-assert
    // multitasking access exactly as the enable command does.
    Self.enableMultitaskingCameraAccess(in: room)
    emitSnapshotChanged()
  }

  // MARK: - Media permissions

  /// Requests microphone access only; LiveKit owns the audio session.
  nonisolated static func requestMicrophonePermission() async -> Bool {
    if #available(iOS 17.0, macOS 14.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted:
        return true
      case .denied:
        return false
      case .undetermined:
        return await withCheckedContinuation { continuation in
          AVAudioApplication.requestRecordPermission { granted in
            continuation.resume(returning: granted)
          }
        }
      @unknown default:
        return false
      }
    }
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted:
      return true
    case .denied:
      return false
    case .undetermined:
      return await withCheckedContinuation { continuation in
        session.requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      }
    @unknown default:
      return false
    }
  }

  /// Requests camera access only; LiveKit owns device selection and capture.
  nonisolated static func requestCameraPermission() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      return true
    case .denied, .restricted:
      return false
    case .notDetermined:
      return await withCheckedContinuation { continuation in
        AVCaptureDevice.requestAccess(for: .video) { granted in
          continuation.resume(returning: granted)
        }
      }
    @unknown default:
      return false
    }
  }
}

// MARK: - RoomDelegate
//
// Called on LiveKit's multicast queue via weak references; every method hops
// onto the main actor and re-verifies room identity before touching state.

extension RoomController: RoomDelegate {
  @objc nonisolated func room(
    _ room: Room, didUpdateConnectionState connectionState: ConnectionState,
    from oldConnectionState: ConnectionState
  ) {
    Task { @MainActor [weak self] in
      self?.handleConnectionState(connectionState, from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, didDisconnectWithError error: LiveKitError?
  ) {
    Task { @MainActor [weak self] in
      self?.handleDisconnect(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode
  ) {
    Task { @MainActor [weak self] in
      self?.handleReconnecting(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode
  ) {
    Task { @MainActor [weak self] in
      self?.handleReconnected(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, participantDidConnect participant: RemoteParticipant
  ) {
    Task { @MainActor [weak self] in
      self?.updateRemoteParticipants(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, participantDidDisconnect participant: RemoteParticipant
  ) {
    Task { @MainActor [weak self] in
      if let identity = participant.identity?.stringValue {
        self?.participantVolumes.removeValue(forKey: identity)
        self?.screenShareVolumes.removeValue(forKey: identity)
      }
      self?.updateRemoteParticipants(from: room)
    }
  }

  // The explicit selectors below are required by the SDK: they disambiguate
  // the remote-participant variants from the local ones.

  @objc(room:remoteParticipant:didPublishTrack:) nonisolated func room(
    _ room: Room, participant: RemoteParticipant,
    didPublishTrack publication: RemoteTrackPublication
  ) {
    Task { @MainActor [weak self] in
      self?.updateRemoteParticipants(from: room)
    }
  }

  @objc(room:remoteParticipant:didUnpublishTrack:) nonisolated func room(
    _ room: Room, participant: RemoteParticipant,
    didUnpublishTrack publication: RemoteTrackPublication
  ) {
    Task { @MainActor [weak self] in
      if publication.source == .screenShareVideo || publication.source == .screenShareAudio,
        let identity = participant.identity?.stringValue
      {
        self?.screenShareVolumes.removeValue(forKey: identity)
        self?.applyParticipantVolumes()
      }
      self?.updateRemoteParticipants(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, participant: RemoteParticipant,
    didSubscribeTrack publication: RemoteTrackPublication
  ) {
    Task { @MainActor [weak self] in
      self?.applyParticipantVolumes()
      self?.updateRemoteParticipants(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, participant: RemoteParticipant,
    didUnsubscribeTrack publication: RemoteTrackPublication
  ) {
    Task { @MainActor [weak self] in
      self?.updateRemoteParticipants(from: room)
    }
  }

  @objc nonisolated func room(
    _ room: Room, participant: Participant,
    trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool
  ) {
    Task { @MainActor [weak self] in
      self?.updateRemoteParticipants(from: room)
    }
  }

  // MARK: Delegate handlers (main actor)

  private func handleConnectionState(_ state: ConnectionState, from room: Room) {
    guard room === self.room else { return }
    switch state {
    case .connecting:
      applyConnectionState(.connecting, from: room)
    case .connected:
      applyConnectionState(.connected, from: room)
    case .reconnecting:
      applyConnectionState(.reconnecting, from: room)
    case .disconnected, .disconnecting:
      // Terminal disconnects surface through didDisconnectWithError; the
      // disconnect path clears state synchronously.
      break
    }
  }

  private func handleDisconnect(from room: Room) {
    guard room === self.room else { return }
    guard connectionState != .idle, connectionState != .failed else { return }

    // If the LiveKit engine is already trying to reconnect
    // (didStartReconnectWithMode fired), this is not terminal; let the
    // reconnect cycle continue.
    if connectionState == .reconnecting {
      logRoom("Disconnect during active reconnection: letting reconnect continue")
      return
    }

    // The SDK only reports this once its own retry ladder is exhausted and the
    // engine is torn down (it clears `e2eeManager` first), so nothing can
    // recover. In-progress reconnection arrives as `didStartReconnectWithMode`
    // instead, which the guard above covers.
    logRoom("Disconnected after a successful connection: failing the call")
    failCall(from: room)
  }

  private func failCall(from room: Room) {
    guard room === self.room, connectionState != .idle, connectionState != .failed else { return }
    // The call is over as far as LiveKit is concerned, so the system call UI
    // must go with it; leaving it up strands a CX call the user can only end
    // from the lock screen.
    if let callId { callKitController?.endCall(callId: callId, remoteEnded: true, reason: .failed) }
    self.room = nil
    pipEnabled = false
    keyProvider = nil
    microphoneEnabled = false
    cameraEnabled = false
    cameraMutedByInterruption = false
    screenShareEnabled = false
    callKitController?.setCameraActive(false)
    participantCount = 0
    remoteParticipants = []
    lastError = BridgeError(.disconnected)
    localConnectionQuality = nil
    connectionState = .failed
    removeOverlayViews()
    removeLocalOverlayView()
    if #available(iOS 15.0, *) { stopPiP() }
    emitSnapshotChanged()
  }

  private func handleReconnecting(from room: Room) {
    guard room === self.room else { return }
    guard connectionState == .connected else { return }
    applyConnectionState(.reconnecting, from: room)
  }

  private func handleReconnected(from room: Room) {
    guard room === self.room else { return }
    guard connectionState == .reconnecting else { return }
    applyConnectionState(.connected, from: room)
  }

  // MARK: - Connection-quality delegate & helpers

  @objc(room:participant:didUpdateConnectionQuality:) nonisolated func room(
    _ room: Room, participant: Participant,
    didUpdateConnectionQuality quality: ConnectionQuality
  ) {
    Task { @MainActor [weak self] in
      self?.handleConnectionQuality(quality, participant: participant, from: room)
    }
  }

  /// Maps the LiveKit ``ConnectionQuality`` enum to the bound wire string
  /// vocabulary ("lost" / "poor" / "good" / "excellent" / "unknown").
  nonisolated static func connectionQualityWire(
    _ q: ConnectionQuality
  ) -> BridgeConnectionQuality? {
    switch q {
    case .lost: return .lost
    case .poor: return .poor
    case .good: return .good
    case .excellent: return .excellent
    case .unknown: return nil
    }
  }

  private func handleConnectionQuality(
    _ quality: ConnectionQuality, participant: Participant, from room: Room
  ) {
    guard room === self.room else { return }
    guard connectionState == .connected || connectionState == .reconnecting
    else { return }

    if participant is LocalParticipant {
      let wire = Self.connectionQualityWire(quality)
      guard localConnectionQuality != wire else { return }
      localConnectionQuality = wire
      emitSnapshotChanged()
    } else {
      // This event always changes the remote projection (at minimum the
      // quality field), so recompute and emit unconditionally.
      updateRemoteParticipants(from: room)
    }
  }

  /// Recomputes the remote-only projection from a room event and emits one
  /// snapshot_changed when it (and with it the count) actually changed. Any
  /// participant/publication/subscription event also reconciles the video
  /// overlay against the room's current truth, even when the snapshot
  /// projection itself is unchanged.
  private func updateRemoteParticipants(from room: Room) {
    guard room === self.room else { return }
    guard connectionState == .connected || connectionState == .reconnecting
    else { return }
    reconcileOverlay(in: room)
    reconcileLocalOverlay(in: room)
    let projection = Self.projectRemoteParticipants(in: room)
    guard projection != remoteParticipants else { return }
    remoteParticipants = projection
    participantCount = projection.count
    emitSnapshotChanged()
  }
}

// MARK: - AVPictureInPictureControllerDelegate (RoomController)

@available(iOS 15.0, *)
extension RoomController: AVPictureInPictureControllerDelegate {
  /// The in-app tile was never handed to PiP, so there is nothing to restore.
  nonisolated func pictureInPictureController(
    _ controller: AVPictureInPictureController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(true)
  }

  /// The controller stays armed when PiP is still enabled, so the system can
  /// auto-start it again the next time the app backgrounds.
  nonisolated func pictureInPictureControllerDidStopPictureInPicture(
    _ controller: AVPictureInPictureController
  ) {
    Task { @MainActor [weak self] in
      guard let self, !pipEnabled else { return }
      releasePiP()
    }
  }
}

// MARK: - PiP content renderer (iOS 15+)

/// The view the PiP window composites. Apple's video-call PiP takes the content
/// view controller's own `view` and displays that view's backing layer, so the
/// sample-buffer layer has to be the layer class itself and not a sublayer.
@available(iOS 15.0, *)
private final class SampleBufferView: UIView {
  override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

  /// Safe by construction: `layerClass` above decides the layer's type.
  var displayLayer: AVSampleBufferDisplayLayer {
    layer as! AVSampleBufferDisplayLayer
  }
}

/// The PiP window's content, fed by registering as a ``VideoRenderer`` directly
/// on the track.
///
/// A `VideoView` cannot back PiP: it tears down and recreates its primary
/// renderer, and with it a brand new `AVSampleBufferDisplayLayer`, on any track,
/// render-mode or should-render change, which leaves `AVPictureInPictureController`
/// bound to a layer nothing enqueues into any more. A renderer registered on the
/// track owns exactly one layer for the controller's whole lifetime.
@available(iOS 15.0, *)
final class PiPVideoCallViewController: AVPictureInPictureVideoCallViewController,
  VideoRenderer
{
  private let renderingView = SampleBufferView()
  /// Last applied rotation and content size. Frames carry both on every frame,
  /// but re-applying them would run a layer transform and a PiP window resize
  /// 30 times a second for nothing.
  private var appliedRotation: VideoRotation?
  private var appliedContentSize: CGSize?

  override func loadView() {
    renderingView.displayLayer.videoGravity = .resizeAspectFill
    view = renderingView
  }

  // MARK: VideoRenderer

  /// Declares the PiP window a real consumer of the track, so adaptive stream
  /// keeps the subscription enabled and sized for it instead of following only
  /// what the on-screen tile asks for.
  var isAdaptiveStreamEnabled: Bool { true }

  /// The PiP window's size once the system has laid the view out; zero before
  /// that, which adaptive stream skips as "not known yet".
  var adaptiveStreamSize: CGSize { view.bounds.size }

  /// Called on LiveKit's render thread.
  nonisolated func render(frame: VideoFrame) {
    guard let sampleBuffer = frame.toCMSampleBuffer() else { return }
    let rotation = frame.rotation
    let contentSize = frame.rotatedSize
    Task { @MainActor [weak self] in
      self?.display(sampleBuffer, rotation: rotation, contentSize: contentSize)
    }
  }

  private func display(
    _ sampleBuffer: CMSampleBuffer, rotation: VideoRotation, contentSize: CGSize
  ) {
    let layer = renderingView.displayLayer
    // The layer gives up its decoder resources when the app is backgrounded,
    // which is exactly when the PiP window is on screen. Until it is flushed it
    // silently drops every enqueue, so the window would stay black for the rest
    // of the call. A failed status likewise only clears through a flush.
    if #available(iOS 17.0, *) {
      let renderer = layer.sampleBufferRenderer
      if renderer.requiresFlushToResumeDecoding || renderer.status == .failed {
        renderer.flush()
      }
      renderer.enqueue(sampleBuffer)
    } else {
      if layer.requiresFlushToResumeDecoding || layer.status == .failed {
        layer.flush()
      }
      layer.enqueue(sampleBuffer)
    }

    if appliedRotation != rotation {
      appliedRotation = rotation
      layer.setAffineTransform(
        CGAffineTransform(rotationAngle: rotation.rotationAngle))
    }
    // Drives the PiP window's aspect ratio.
    if appliedContentSize != contentSize {
      appliedContentSize = contentSize
      preferredContentSize = contentSize
    }
  }
}

extension VideoRotation {
  /// A frame's pixels are stored unrotated with the rotation carried alongside
  /// them, and the layer displays the buffer as-is, so the layer has to be
  /// transformed by that angle.
  fileprivate var rotationAngle: CGFloat {
    switch self {
    case ._0: return 0
    case ._90: return .pi / 2
    case ._180: return .pi
    case ._270: return 3 * .pi / 2
    }
  }
}

extension VideoFrame {
  /// The frame's dimensions after its rotation is applied, which is what the
  /// PiP window's aspect ratio has to follow.
  fileprivate var rotatedSize: CGSize {
    switch rotation {
    case ._90, ._270:
      return CGSize(width: Int(dimensions.height), height: Int(dimensions.width))
    default:
      return CGSize(width: Int(dimensions.width), height: Int(dimensions.height))
    }
  }
}

// MARK: - Logging helper (RoomController)

private func logRoom(_ message: String) {
  #if DEBUG
  NSLog("[RoomController] \(message)")
  #endif
}
