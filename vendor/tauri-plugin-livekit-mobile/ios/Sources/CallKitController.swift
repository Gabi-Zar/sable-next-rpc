import AVFoundation
import CallKit
import LiveKit
import PushKit
import StoreKit
import UIKit

/// Owns the system call UI (CallKit) and the audio-session arbitration
/// window between CallKit and LiveKit. One MatrixRTC room maps to one
/// CXCall. `maximumCallGroups=3, maximumCallsPerCallGroup=1` so iOS
/// never attempts to merge group calls.
///
/// All mutating methods are main-actor isolated; the CXProvider delegate
/// queue is nil (main) to stay serialized with the @MainActor
/// RoomController.
///
/// Pending-action queue: when the JS webview is suspended (lock-screen
/// answer, background incoming call), CXAnswerCallAction /
/// CXEndCallAction / CXSetMutedCallAction are queued here. The JS side
/// drains them via a dedicated command once it is ready to consume them.
@MainActor
final class CallKitController: NSObject {

  // MARK: - Core

  private var provider: CXProvider?
  private var controller: CXCallController?

  /// Whether CallKit's provider has signaled readiness via providerDidBegin.
  /// All call-start/answer/end requests check this flag and enqueue pending
  /// work if the provider is not yet ready.
  private var providerReady = false

  /// Whether the local camera is currently enabled; picks .videoChat vs
  /// .voiceChat mode for proximity sensor control.
  private var cameraActive = false

  /// uuid → callId mapping so delegate events can locate the call.
  private var callByUUID: [UUID: String] = [:]
  /// callId → uuid reverse lookup.
  private var uuidByCallId: [String: UUID] = [:]

  /// Tracked system-state lifecycle per UUID for retry-until-confirmed
  /// end-call logic.
  private enum SystemCallState {
    case notReported
    case pending
    case reported
    case removed
  }
  private var systemState: [UUID: SystemCallState] = [:]

  /// Pending system-initiated answer actions (not yet fulfilled).
  /// Fulfilled by JS via `fulfillAnswerCall` after the room connects.
  /// Keyed by call UUID (not action UUID: multiple actions per call).
  private var pendingAnswerActions: [UUID: (action: CXAnswerCallAction, enqueuedAt: DispatchTime)] = [:]

  /// Pending system-initiated end actions. Nothing enqueues here any more: a
  /// system end is fulfilled as soon as the native teardown returns, because
  /// the webview that used to confirm it may be suspended behind the lock
  /// screen. Kept so `fulfillEndCall` stays a safe no-op for the existing
  /// bridge command.
  private var pendingEndActions: [UUID: (action: CXEndCallAction, enqueuedAt: DispatchTime)] = [:]

  /// Track app-initiated mute action UUIDs to suppress feedback loops
  /// when CXSetMutedCallAction echoes back through the delegate.
  private var appInitiatedMuteActionIds: Set<UUID> = []
  /// Last mute value requested by the app (suppresses iOS 17+ system echo).
  private var lastAppRequestedMute: Bool?

  /// When true, skip the first unmute action arriving after a remote answer
  /// to suppress a transient echo from the system UI.
  private var ignoreFirstUnmuteAfterRemoteAnswer = false

  /// UUIDs whose current answer/end action the app itself requested. The
  /// provider delegate fulfills those directly; anything else came from the
  /// system UI and is deferred until JS confirms.
  private var appRequestedActions: Set<UUID> = []

  private var answeredCalls: Set<UUID> = []
  var hasAnsweredCall: Bool { !answeredCalls.isEmpty }

  /// Actions deferred until providerDidBegin fires.
  private var pendingStartupActions: [() -> Void] = []

  /// How many times `providerDidReset` has replaced the provider this launch.
  private var providerRebuilds = 0
  private static let maxProviderRebuilds = 3

  /// Whether `setAudioRoute` last forced the output to the speaker; used by
  /// the route picker to tell a receiver-less device from a receiver that is
  /// simply not carrying the route.

  /// The two audio-session modes are mutually exclusive:
  ///
  /// - CallKit present: the SDK must not touch AVAudioSession and the engine
  ///   stays unavailable until `provider(_:didActivate:)` grants a window.
  /// - No CallKit (restricted or unknown storefront): nothing will ever grant that window, so
  ///   LiveKit keeps its own automatic session management.
  ///
  /// Set from `Plugin.load()` before any Room connects.
  func applyAudioSessionOwnership() {
    AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = !ownsAudioSession
    // The no-CallKit branch is the one place outside `provider(_:didActivate:)`
    // that may enable the engine: there is no CXProvider to grant an audio
    // window, so nothing else would ever turn it on.
    setEngine(
      ownsAudioSession ? .none : .default,
      reason: ownsAudioSession ? "CallKit owns the session" : "LiveKit owns the session")
  }

  /// Suspends the engine until CallKit re-activates the session. A no-op when
  /// LiveKit owns the session, where nothing would ever restore it.
  func suspendEngineUntilActivation() {
    guard ownsAudioSession else { return }
    setEngine(.none, reason: "waiting for CallKit activation")
  }

  /// Applies an engine availability, reporting failures. A dropped change
  /// leaves the engine in the wrong state for the rest of the call, so it must
  /// never be swallowed.
  @discardableResult
  private func setEngine(_ availability: AudioEngineAvailability, reason: String) -> Bool {
    do {
      try AudioManager.shared.setEngineAvailability(availability)
      return true
    } catch {
      log("Engine availability change failed (\(reason)): \(error.localizedDescription)")
      return false
    }
  }

  // MARK: - Init

  private var storefrontCountry: String?
  private var storefrontTask: Task<Void, Never>?
  private var localeObserver: NSObjectProtocol?

  private var regionAllowsCallKit: Bool {
    CallKitRegion.isAllowed(
      deviceRegion: Locale.autoupdatingCurrent.regionCode,
      storefrontCountry: storefrontCountry)
  }

  var isCallKitAvailable: Bool { regionAllowsCallKit && provider != nil }
  private var callKitDisabled: Bool { !isCallKitAvailable }
  private var ownsAudioSession: Bool { isCallKitAvailable }

  /// No CallKit or PushKit objects exist until StoreKit confirms an allowed storefront.
  func start() {
    guard storefrontTask == nil else { return }
    applyAudioSessionOwnership()
    localeObserver = NotificationCenter.default.addObserver(
      forName: NSLocale.currentLocaleDidChangeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in self?.refreshRegion() }
    }
    storefrontTask = Task { @MainActor [weak self] in
      let storefront = await Storefront.current
      self?.updateStorefront(storefront?.countryCode)
      for await storefront in Storefront.updates {
        guard !Task.isCancelled else { return }
        self?.updateStorefront(storefront.countryCode)
      }
    }
  }

  deinit {
    storefrontTask?.cancel()
    if let localeObserver { NotificationCenter.default.removeObserver(localeObserver) }
  }

  private func updateStorefront(_ country: String?) {
    storefrontCountry = country
    refreshRegion()
  }

  func refreshRegion() {
    if !regionAllowsCallKit {
      guard provider != nil else { return }
      // Stop system integration while leaving the LiveKit room running.
      provider?.setDelegate(nil, queue: nil)
      for uuid in callByUUID.keys {
        provider?.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
      }
      for pending in pendingAnswerActions.values { pending.action.fail() }
      for pending in pendingEndActions.values { pending.action.fail() }
      let startupActions = pendingStartupActions
      discardCallState()
      provider?.invalidate()
      provider = nil
      controller = nil
      providerReady = false
      pushRegistry?.desiredPushTypes = []
      pushRegistry?.delegate = nil
      pushRegistry = nil
      voipToken = nil
      UIApplication.shared.isIdleTimerDisabled = false
      applyAudioSessionOwnership()
      for action in startupActions { action() }
      return
    }
    guard provider == nil else { return }
    // A storefront becoming available must not interrupt an ongoing VoIP call.
    guard roomController?.snapshot().callId == nil else { return }
    controller = CXCallController()
    provider = CXProvider(configuration: Self.makeProviderConfiguration())
    provider?.setDelegate(self, queue: nil)
    providerRebuilds = 0
    let observer = CXCallObserver()
    for call in observer.calls {
      let action = CXEndCallAction(call: call.uuid)
      controller?.request(CXTransaction(action: action)) { error in
        if let error { log("Orphan call cleanup failed: \(error.localizedDescription)") }
      }
    }
    applyAudioSessionOwnership()
    setupPushKit()
  }

  /// One configuration source so the provider can be rebuilt identically after
  /// `providerDidReset`.
  ///
  /// `maximumCallGroups` stays at 3 against the bridge's single active room:
  /// orphaned CX calls from a previous launch each occupy a group, and the
  /// slack is what keeps a fresh call from being rejected with
  /// `CXErrorCodeRequestTransactionError.maximumCallGroupsReached` (7) while
  /// the best-effort cleanup below is still running.
  /// `maximumCallsPerCallGroup = 1` is what actually stops iOS from merging
  /// group calls.
  private nonisolated static func makeProviderConfiguration() -> CXProviderConfiguration {
    let config = CXProviderConfiguration()
    config.maximumCallGroups = 3
    config.maximumCallsPerCallGroup = 1
    // Only .generic handles are ever built; advertising .phoneNumber would
    // list the app as a calling option for phone numbers.
    config.supportedHandleTypes = [.generic]
    config.supportsVideo = true
    // Ringtone sound from the app bundle; nil = system default.
    config.ringtoneSound = nil
    config.iconTemplateImageData = nil
    return config
  }

  nonisolated override init() {
    super.init()

    // Observe audio session interruptions (cellular call, Siri, hardware
    // mic-mute, route disconnect) and route changes (Bluetooth connect/
    // disconnect, headphones, Control Center route picker).
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAudioInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleMediaServicesReset(_:)),
      name: AVAudioSession.mediaServicesWereResetNotification,
      object: nil
    )
  }

  @objc private nonisolated func handleAudioInterruption(_ notification: Notification) {
    guard let info = notification.userInfo,
          let typeRaw = info["AVAudioSessionInterruptionTypeKey"] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }

    Task { @MainActor [weak self] in
      guard let self, ownsAudioSession else { return }
      switch type {
      case .began:
        // An interruption started (e.g. cellular call came in). Suspend the
        // LiveKit engine so it doesn't fight the interrupting audio source.
        setEngine(.none, reason: "audio interruption began")
        log("Audio interruption began: engine suspended")
      case .ended:
        // The engine deliberately stays suspended. CallKit re-activates the
        // session when the interruption clears, and
        // `provider(_:didActivate:)` is the only place allowed to restart the
        // engine; restarting it here would race that activation.
        log("Audio interruption ended: waiting for CallKit to re-activate the session")
      @unknown default:
        break
      }
    }
  }

  @objc private nonisolated func handleRouteChange(_ notification: Notification) {
    Task { @MainActor in
      log("Audio route changed: LiveKit will pick up the new route automatically")
    }
  }

  @objc private nonisolated func handleMediaServicesReset(_ notification: Notification) {
    Task { @MainActor [weak self] in
      guard let self, ownsAudioSession else { return }
      log("Media services were reset: full media stack re-activation required")
      setEngine(.none, reason: "media services reset")
      triggerToJS("callkit_event", data: .end(uuid: ""))
    }
  }

  // MARK: - UUID ↔ callId

  func callId(for uuid: UUID) -> String? {
    callByUUID[uuid]
  }

  /// Resolves a callId to its CX UUID. An incoming call is reported before the
  /// app knows a callId for it, so it is registered under its UUID string and
  /// that string resolves here too.
  private func uuid(forCallId callId: String) -> UUID? {
    if let uuid = uuidByCallId[callId] { return uuid }
    guard let parsed = UUID(uuidString: callId), callByUUID[parsed] != nil else {
      return nil
    }
    return parsed
  }

  /// Maps uuid ↔ callId, dropping any earlier callId bound to this uuid.
  private func bind(uuid: UUID, callId: String) {
    if let previous = callByUUID[uuid], previous != callId {
      uuidByCallId.removeValue(forKey: previous)
    }
    callByUUID[uuid] = callId
    uuidByCallId[callId] = uuid
    endedCallIds.remove(callId)
  }

  /// Drops all bookkeeping for a call that is no longer live.
  private func forget(uuid: UUID) {
    if let callId = callByUUID.removeValue(forKey: uuid) {
      uuidByCallId.removeValue(forKey: callId)
      endedCallIds.insert(callId)
    }
    appRequestedActions.remove(uuid)
    answeredCalls.remove(uuid)
    incomingPayloads.removeValue(forKey: uuid)
    systemState[uuid] = .removed
  }

  /// Call ids whose CX call has already been ended. A terminal LiveKit failure
  /// ends the system call and the host then disconnects the same id, so without
  /// this the second end would fabricate a temporary CX call for a call that is
  /// already gone.
  private var endedCallIds: Set<String> = []

  /// The invitation identity carried by a VoIP push, retained until the call is
  /// forgotten. A lock-screen answer arrives while the webview is suspended, so
  /// the answer action has to carry the room it belongs to; without it the host
  /// resumes with a UUID it cannot resolve to anything.
  struct IncomingCallPayload {
    let roomId: String
    let callerName: String
    let notificationEventId: String?
    let hasVideo: Bool
  }
  private var incomingPayloads: [UUID: IncomingCallPayload] = [:]

  // MARK: - Surfaces (called by Plugin / RoomController)

  /// Returns true if there is already an active CallKit call. Used by the
  /// app to reject new calls when one is already in progress.
  func hasRegisteredCall() -> Bool {
    guard !callKitDisabled else { return false }
    return !callByUUID.isEmpty
  }

  /// Shows an incoming call on the lock screen / system UI. `outcome` runs once
  /// CallKit has accepted or rejected the report, never before: the PushKit
  /// completion handler and the JS invoke both hang off it.
  func reportIncomingCall(
    uuid: UUID, callerName: String, roomId: String? = nil, hasVideo: Bool = false,
    notificationEventId: String? = nil,
    outcome: @escaping (BridgeFailureCode?) -> Void = { _ in }
  ) {
    guard !callKitDisabled else {
      outcome(.unavailable)
      return
    }
    if callByUUID[uuid] != nil {
      outcome(nil)
      return
    }
    // Registered under the UUID string until `answerCall` binds the real
    // callId, so the call-scoped surfaces can address it in the meantime.
    bind(uuid: uuid, callId: uuid.uuidString)
    systemState[uuid] = .pending
    if let roomId {
      incomingPayloads[uuid] = IncomingCallPayload(
        roomId: roomId, callerName: callerName, notificationEventId: notificationEventId,
        hasVideo: hasVideo)
    }

    let update = CXCallUpdate()
    update.localizedCallerName = callerName
    update.hasVideo = hasVideo
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    update.supportsHolding = false

    // Begin a background task so the incoming-call report window survives
    // even if the app is backgrounded before the report completes.
    var bgTaskId: UIBackgroundTaskIdentifier = .invalid
    bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "VoIP incoming call") {
      // Expiration handler: end the task so the system doesn't kill us.
      if bgTaskId != .invalid {
        UIApplication.shared.endBackgroundTask(bgTaskId)
        bgTaskId = .invalid
      }
    }

    provider?.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      var code: BridgeFailureCode?
      defer {
        if bgTaskId != .invalid {
          UIApplication.shared.endBackgroundTask(bgTaskId)
          bgTaskId = .invalid
        }
        outcome(code)
      }
      guard let self else {
        code = .unavailable
        return
      }

      if let error {
        code = Self.bridgeCode(for: error)
        let nsError = error as NSError
        // Map known incoming-call filtering errors to .declinedElsewhere so
        // the system UI dismisses cleanly.
        if nsError.domain == CXErrorDomainIncomingCall {
          switch CXErrorCodeIncomingCallError.Code(rawValue: nsError.code) {
          case .filteredByDoNotDisturb, .filteredByBlockList,
            .filteredBySensitiveParticipants:
            provider?.reportCall(with: uuid, endedAt: nil, reason: .declinedElsewhere)
            forget(uuid: uuid)
            triggerToJS("callkit_event", data: .end(uuid: uuid.uuidString))
            log("Incoming call filtered by the system for \(uuid)")
            return
          default:
            break
          }
        }
        log("reportNewIncomingCall error: \(error.localizedDescription)")
        forget(uuid: uuid)
        return
      }
      systemState[uuid] = .reported
    }
  }

  /// Reports a call that is immediately ended (malformed/expired VoIP push)
  /// without ever showing the incoming-call UI. Still a report, so it satisfies
  /// PushKit's requirement that every VoIP push reach CallKit.
  func reportImmediatelyEndedCall(
    uuid: UUID, reason: CXCallEndedReason, outcome: @escaping () -> Void = {}
  ) {
    guard !callKitDisabled else {
      outcome()
      return
    }
    provider?.reportNewIncomingCall(
      with: uuid,
      update: CXCallUpdate()) { [weak self] error in
        defer { outcome() }
        guard let self else { return }
        if let error {
          log("reportImmediatelyEndedCall report failed: \(error.localizedDescription)")
        } else {
          provider?.reportCall(with: uuid, endedAt: nil, reason: reason)
        }
        forget(uuid: uuid)
      }
  }

  /// Marks the system call as started (outgoing). `outcome` settles once the
  /// transaction has been accepted or rejected by the system.
  func startOutgoingCall(
    uuid: UUID, callId: String, callerName: String,
    outcome: @escaping (BridgeFailureCode?) -> Void = { _ in }
  ) {
    guard !callKitDisabled else {
      outcome(.unavailable)
      return
    }

    bind(uuid: uuid, callId: callId)
    systemState[uuid] = .pending

    guard providerReady else {
      pendingStartupActions.append { [weak self] in
        self?.startOutgoingCall(
          uuid: uuid, callId: callId, callerName: callerName, outcome: outcome)
      }
      return
    }

    let handle = CXHandle(type: .generic, value: callerName)
    let action = CXStartCallAction(call: uuid, handle: handle)
    action.isVideo = false  // video starts off; user toggles in-app
    controller?.request(
      CXTransaction(action: action)
    ) { [weak self] error in
      if let error {
        log("CXStartCallAction error: \(error.localizedDescription)")
        self?.forget(uuid: uuid)
        outcome(Self.bridgeCode(for: error))
      } else {
        self?.systemState[uuid] = .reported
        outcome(nil)
      }
    }
  }

  /// Answers a CX call from a delegate action (app-initiated path).
  /// The app pre-answered via the system UI and now connects.
  func answerCall(
    uuid: UUID, callId: String,
    outcome: @escaping (BridgeFailureCode?) -> Void = { _ in }
  ) {
    guard !callKitDisabled else {
      outcome(.unavailable)
      return
    }
    bind(uuid: uuid, callId: callId)

    guard providerReady else {
      pendingStartupActions.append { [weak self] in
        self?.answerCall(uuid: uuid, callId: callId, outcome: outcome)
      }
      return
    }

    appRequestedActions.insert(uuid)
    let action = CXAnswerCallAction(call: uuid)
    controller?.request(
      CXTransaction(action: action)
    ) { error in
      if let error {
        log("CXAnswerCallAction error: \(error.localizedDescription)")
        outcome(Self.bridgeCode(for: error))
      } else {
        outcome(nil)
      }
    }
  }

  /// Maps a CallKit transaction or incoming-call report failure onto the
  /// bounded bridge vocabulary. Native error descriptions never cross the
  /// bridge, so the code is all the caller gets: a conflict with a call the
  /// system already tracks is `.busy`, a refusal to present the call at all is
  /// `.unavailable`, and a malformed request is `.invalidRequest`.
  private nonisolated static func bridgeCode(for error: Error) -> BridgeFailureCode {
    let nsError = error as NSError
    switch nsError.domain {
    case CXErrorDomainRequestTransaction:
      switch CXErrorCodeRequestTransactionError.Code(rawValue: nsError.code) {
      case .callUUIDAlreadyExists, .maximumCallGroupsReached:
        return .busy
      case .emptyTransaction, .invalidAction, .unknownCallUUID, .unknownCallProvider:
        return .invalidRequest
      case .unentitled:
        return .unavailable
      default:
        return .unexpected
      }
    case CXErrorDomainIncomingCall:
      switch CXErrorCodeIncomingCallError.Code(rawValue: nsError.code) {
      case .callUUIDAlreadyExists:
        return .busy
      case .unentitled, .filteredByDoNotDisturb, .filteredByBlockList,
        .filteredBySensitiveParticipants:
        return .unavailable
      default:
        return .unexpected
      }
    default:
      return .unexpected
    }
  }

  /// Fulfills a pending system-initiated answer action. Called by JS after
  /// the LiveKit room connects. Auto-fails after 30s if JS never responds.
  func fulfillAnswerCall(uuid: UUID, didFail: Bool = false) {
    guard !callKitDisabled else { return }
    guard let pending = pendingAnswerActions.removeValue(forKey: uuid) else { return }
    if didFail {
      pending.action.fail()
      log("Failed pending answer for \(uuid)")
    } else {
      pending.action.fulfill(withDateConnected: Date())
      log("Fulfilled pending answer for \(uuid)")
    }
  }

  /// Fulfills a pending system-initiated end action. Called by JS after
  /// cleanup completes.
  func fulfillEndCall(uuid: UUID, didFail: Bool = false) {
    guard !callKitDisabled else { return }
    guard let pending = pendingEndActions.removeValue(forKey: uuid) else { return }
    if didFail {
      pending.action.fail()
      log("Failed pending end for \(uuid)")
    } else {
      pending.action.fulfill(withDateEnded: Date())
      log("Fulfilled pending end for \(uuid)")
    }
  }

  /// Tracks the local camera state and re-applies the audio-session mode
  /// mid-call: the camera is normally enabled after the call is activated, and
  /// `.videoChat` is what makes the system route to the speaker instead of the
  /// earpiece.
  func setCameraActive(_ active: Bool) {
    guard cameraActive != active else { return }
    cameraActive = active
    guard ownsAudioSession, !callByUUID.isEmpty else { return }
    applyAudioSessionMode()
  }

  /// Applies the call category/mode for the current camera state. `.videoChat`
  /// makes the system add allowBluetoothHFP and defaultToSpeaker on its own;
  /// `.voiceChat` keeps an audio-only call on the earpiece.
  ///
  /// This does not compete with LiveKit: `applyAudioSessionOwnership` turns
  /// `AudioManager.shared.audioSession.isAutomaticConfigurationEnabled` off
  /// whenever CallKit owns the session, and LiveKit's observer then never
  /// touches the category at all.
  @discardableResult
  private func applyAudioSessionMode() -> Bool {
    let mode: AVAudioSession.Mode = cameraActive ? .videoChat : .voiceChat
    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playAndRecord, mode: mode,
        options: [.mixWithOthers, .allowBluetoothHFP, .allowBluetoothA2DP])
    } catch {
      log("Audio session mode \(mode.rawValue) failed: \(error.localizedDescription)")
      return false
    }
    log("Audio session mode applied: \(mode.rawValue)")
    return true
  }

  /// Reports the outgoing call as connected to CallKit. Call after the
  /// LiveKit room transitions to .connected.
  func reportConnected(uuid: UUID) {
    guard !callKitDisabled else { return }
    provider?.reportOutgoingCall(with: uuid, connectedAt: Date())
    log("Reported outgoing call connected for \(uuid)")
  }

  /// Ends the CX call (both outgoing and incoming), reporting it as remote
  /// or local as appropriate. `outcome` settles once the end has actually been
  /// reported or the transaction has come back from the system.
  func endCall(
    callId: String, remoteEnded: Bool = false, reason: CXCallEndedReason? = nil,
    outcome: @escaping (BridgeFailureCode?) -> Void = { _ in }
  ) {
    guard !callKitDisabled else {
      outcome(.unavailable)
      return
    }

    guard !endedCallIds.contains(callId) else {
      // Already ended (typically a terminal LiveKit failure followed by the
      // host's own disconnect); the system call is gone.
      outcome(nil)
      return
    }

    guard let uuid = uuid(forCallId: callId) else {
      // Not yet mapped (e.g. outgoing call that never reached startOutgoingCall):
      // best-effort report with a temp UUID so the system UI dismisses.
      if !remoteEnded {
        let tempUuid = UUID()
        let action = CXEndCallAction(call: tempUuid)
        controller?.request(
          CXTransaction(action: action)
        ) { error in
          if let error {
            log("CXEndCallAction temp error: \(error.localizedDescription)")
          }
        }
        provider?.reportCall(with: tempUuid, endedAt: nil, reason: .remoteEnded)
      }
      // Nothing is tracked under this call id, so there is nothing left to end.
      outcome(nil)
      return
    }

    guard providerReady else {
      pendingStartupActions.append { [weak self] in
        self?.endCall(
          callId: callId, remoteEnded: remoteEnded, reason: reason, outcome: outcome)
      }
      return
    }

    // endCallOnceReported retry logic: if the call is still in .pending
    // state (not yet reported by the system), schedule a retry.
    let state = systemState[uuid] ?? .notReported
    switch state {
    case .pending:
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
        guard let self else {
          outcome(.unavailable)
          return
        }
        guard self.systemState[uuid] == .pending else {
          // The system reported the call while we waited. Re-enter so it goes
          // down the normal end path; returning here would leave it live.
          self.endCall(
            callId: callId, remoteEnded: remoteEnded, reason: reason, outcome: outcome)
          return
        }
        log("Retrying endCall for \(uuid): still pending")
        // Force-end by reporting directly.
        self.provider?.reportCall(with: uuid, endedAt: nil, reason: reason ?? .remoteEnded)
        self.forget(uuid: uuid)
        outcome(nil)
      }
      return
    case .notReported:
      // Never reported: end immediately via direct report.
      provider?.reportCall(with: uuid, endedAt: nil, reason: reason ?? .remoteEnded)
      forget(uuid: uuid)
      outcome(nil)
      return
    case .reported:
      break  // proceed with normal end
    case .removed:
      // Already cleaned up; nothing to do.
      outcome(nil)
      return
    }

    if remoteEnded {
      provider?.reportCall(with: uuid, endedAt: nil, reason: reason ?? .remoteEnded)
      forget(uuid: uuid)
      outcome(nil)
      return
    }

    // The mapping must outlive the request: `CXCallController.request` is
    // async and the provider delegate reads it to tell this app-initiated end
    // from a system-initiated one.
    appRequestedActions.insert(uuid)
    let action = CXEndCallAction(call: uuid)
    controller?.request(
      CXTransaction(action: action)
    ) { [weak self] error in
      if let error {
        log("CXEndCallAction error: \(error.localizedDescription)")
        outcome(Self.bridgeCode(for: error))
      } else {
        outcome(nil)
      }
      self?.forget(uuid: uuid)
    }
  }

  /// Push mute back into CallKit so the system UI stays consistent with
  /// the LiveKit publish state.
  func setMuted(
    _ muted: Bool, for callId: String,
    outcome: @escaping (BridgeFailureCode?) -> Void = { _ in }
  ) {
    guard !callKitDisabled else {
      outcome(.unavailable)
      return
    }
    guard let uuid = uuid(forCallId: callId) else {
      outcome(.invalidRequest)
      return
    }
    let action = CXSetMutedCallAction(call: uuid, muted: muted)
    appInitiatedMuteActionIds.insert(action.uuid)
    lastAppRequestedMute = muted
    controller?.request(
      CXTransaction(action: action)
    ) { error in
      if let error {
        log("CXSetMutedCallAction error: \(error.localizedDescription)")
        outcome(Self.bridgeCode(for: error))
      } else {
        outcome(nil)
      }
    }
  }

  /// Updates the CallKit display (caller name, video indicator) for an
  /// active call.
  func updateCallDisplay(callId: String, callerName: String, hasVideo: Bool? = nil) {
    guard !callKitDisabled else { return }
    guard let uuid = uuid(forCallId: callId) else { return }
    let update = CXCallUpdate()
    update.localizedCallerName = callerName
    if let hasVideo { update.hasVideo = hasVideo }
    provider?.reportCall(with: uuid, updated: update)
  }

  /// Selectable audio outputs for the route picker. iOS has no output
  /// enumeration API, so availability is derived from the current route and
  /// the available inputs.
  ///
  /// The default-output entry is either wired or the receiver, never both:
  /// with a wired output attached, `overrideOutputAudioPort(.none)` lands on
  /// the wired port, so an earpiece entry would be a no-op.
  func getAudioRoutes(callId: String) -> [AudioRoute] {
    guard !callKitDisabled else { return [] }
    let session = AVAudioSession.sharedInstance()
    let outputs = session.currentRoute.outputs
    let inputs = session.availableInputs ?? []
    var routes: [AudioRoute] = []

    let wiredOutput = outputs.first { Self.wiredOutputPorts.contains($0.portType) }
    if wiredOutput != nil || inputs.contains(where: { Self.wiredInputPorts.contains($0.portType) }) {
      routes.append(
        AudioRoute(id: "wired", name: "Headphones", type: "wired", current: wiredOutput != nil))
    } else if hasReceiver {
      routes.append(
        AudioRoute(
          id: "earpiece", name: "iPhone", type: "earpiece",
          current: outputs.contains { $0.portType == .builtInReceiver }))
    }

    routes.append(
      AudioRoute(
        id: "speaker", name: "Speaker", type: "speaker",
        current: outputs.contains { $0.portType == .builtInSpeaker }))

    let bluetoothOutput = outputs.first { Self.bluetoothOutputPorts.contains($0.portType) }
    for input in inputs where input.portType == .bluetoothHFP {
      let current = bluetoothOutput.map { $0.uid == input.uid || $0.portName == input.portName }
      routes.append(
        AudioRoute(
          id: input.uid, name: input.portName, type: "bluetooth", current: current ?? false))
    }

    return routes
  }

  /// Applies a route id handed out by `getAudioRoutes`. Bluetooth outputs are
  /// selected through their HFP input, and the built-in mic has to be restored
  /// explicitly or that preference keeps the output on the headset.
  func setAudioRoute(callId: String, routeId: String) {
    guard !callKitDisabled else { return }
    // callId is unused aside from guard; the route change is session-wide.
    let session = AVAudioSession.sharedInstance()
    switch routeId {
    case "speaker":
      preferInput(portType: .builtInMic)
      try? session.overrideOutputAudioPort(.speaker)
      log("Audio route set to speaker")
    case "earpiece":
      preferInput(portType: .builtInMic)
      try? session.overrideOutputAudioPort(.none)
      log("Audio route set to earpiece")
    case "wired":
      if let wired = session.availableInputs?.first(where: {
        Self.wiredInputPorts.contains($0.portType)
      }) {
        try? session.setPreferredInput(wired)
      }
      try? session.overrideOutputAudioPort(.none)
      log("Audio route set to wired")
    default:
      if let preferredInput = session.availableInputs?.first(where: { $0.uid == routeId }) {
        try? session.overrideOutputAudioPort(.none)
        try? session.setPreferredInput(preferredInput)
        log("Audio route set to bluetooth")
      } else {
        log("Audio route not available")
      }
    }
  }

  /// Having a receiver is a device trait, not a route state: deriving it from
  /// the current outputs makes the earpiece option vanish as soon as audio
  /// moves to the speaker. iPad has no receiver and always uses the speaker.
  private var hasReceiver: Bool {
    UIDevice.current.userInterfaceIdiom == .phone
  }

  private func preferInput(portType: AVAudioSession.Port) {
    let session = AVAudioSession.sharedInstance()
    guard let input = session.availableInputs?.first(where: { $0.portType == portType }) else {
      return
    }
    try? session.setPreferredInput(input)
  }

  private static let wiredOutputPorts: Set<AVAudioSession.Port> = [
    .headphones, .usbAudio, .lineOut,
  ]
  private static let wiredInputPorts: Set<AVAudioSession.Port> = [
    .headsetMic, .usbAudio, .lineIn,
  ]
  private static let bluetoothOutputPorts: Set<AVAudioSession.Port> = [
    .bluetoothHFP, .bluetoothA2DP, .bluetoothLE,
  ]

  // MARK: - Pending action queue (JS-suspended path)

  private var pendingActions: [SystemCallAction] = []

  private func enqueue(_ action: SystemCallAction) {
    pendingActions.append(action)
  }

  /// Returns all queued actions and clears the queue so JS can drain them.
  func drainPendingActions() -> [SystemCallAction] {
    let actions = pendingActions
    pendingActions.removeAll()
    return actions
  }

  // MARK: - Plugin trigger helper

  /// Reference to the owning plugin, set after init so the controller can
  /// `trigger("callkit_event", data:)` back to JS.
  weak var plugin: LivekitMobilePlugin?

  /// Set by the plugin alongside `plugin`. A system-initiated end has to tear
  /// the room down natively, because the webview that would normally do it may
  /// be suspended behind the lock screen.
  weak var roomController: RoomController?

  private func triggerToJS(_ event: String, data: SystemCallAction) {
    guard let plugin else { return }
    do {
      try plugin.trigger(event, data: data)
    } catch {
      log("trigger callkit_event error: \(error.localizedDescription)")
    }
  }

  // MARK: - Cleanup

  func reset() {
    guard !callKitDisabled else { return }
    for (uuid, _) in callByUUID {
      provider?.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
    }
    // Fail all pending actions so they don't hang.
    for (_, pending) in pendingAnswerActions { pending.action.fail() }
    for (_, pending) in pendingEndActions { pending.action.fail() }
    discardCallState()
  }

  /// Drops every piece of per-call bookkeeping without touching the provider.
  /// Separate from `reset()` because a provider that has already reset must not
  /// be handed reports or action responses for calls it no longer knows about.
  private func discardCallState() {
    pendingAnswerActions.removeAll()
    pendingEndActions.removeAll()
    appInitiatedMuteActionIds.removeAll()
    lastAppRequestedMute = nil
    ignoreFirstUnmuteAfterRemoteAnswer = false
    appRequestedActions.removeAll()
    callByUUID.removeAll()
    uuidByCallId.removeAll()
    endedCallIds.removeAll()
    incomingPayloads.removeAll()
    systemState.removeAll()
    pendingActions.removeAll()
    pendingStartupActions.removeAll()
  }

  // MARK: - PushKit (VoIP push notifications)

  private var pushRegistry: PKPushRegistry?
  private(set) var voipToken: String?

  func setupPushKit() {
    guard !callKitDisabled, pushRegistry == nil else { return }
    pushRegistry = PKPushRegistry(queue: nil)
    pushRegistry?.delegate = self
    pushRegistry?.desiredPushTypes = [.voIP]
    log("PushKit VoIP registry set up")
  }
}

// MARK: - PKPushRegistryDelegate

extension CallKitController: PKPushRegistryDelegate {

  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate credentials: PKPushCredentials,
    for type: PKPushType
  ) {
    guard !callKitDisabled, registry === pushRegistry else { return }
    let token = credentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    log("VoIP push token updated")
    guard let plugin else { return }
    do {
      try plugin.trigger("voipTokenUpdated", data: ["token": token])
    } catch {
      log("trigger voipTokenUpdated error: \(error.localizedDescription)")
    }
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    voipToken = nil
    log("VoIP push token invalidated")
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    // PKPushRegistry.h documents `initWithQueue:` as delivering delegate calls
    // on the main queue when the queue is nil, which is how `setupPushKit`
    // creates it, so the report below is issued synchronously on this actor
    // rather than through a Task hop.
    //
    // Every path here reports to CallKit before running `completion`, exactly
    // once. PKPushRegistry.h: "On iOS 13.0 and later, if you fail to report a
    // call to CallKit, the system will terminate your app. Repeatedly failing
    // to report calls may cause the system to stop delivering any more VoIP
    // push notifications to your app." Apple's own sample (Responding to VoIP
    // Notifications from PushKit) calls the completion handler from inside the
    // reportNewIncomingCall completion block for the same reason.
    guard type == .voIP else {
      completion()
      return
    }
    guard !callKitDisabled else {
      // PushKit is never registered in this region, so a push cannot arrive;
      // settle the handler rather than leaving PushKit waiting if it does.
      completion()
      return
    }

    let dict = payload.dictionaryPayload
    guard let roomId = dict["room_id"] as? String,
          let uuidStr = dict["uuid"] as? String,
          let uuid = UUID(uuidString: uuidStr)
    else {
      // A push that cannot be parsed still has to reach CallKit, so it is
      // reported under a fresh UUID and ended immediately.
      log("Malformed VoIP push payload: reporting an immediately ended call")
      reportImmediatelyEndedCall(uuid: UUID(), reason: .failed) { completion() }
      return
    }

    let callerName = dict["caller_name"] as? String ?? "Caller"

    // Check expiration: if the push has an expires_at, check it.
    if let expiresAt = dict["expires_at"] as? TimeInterval,
       Date().timeIntervalSince1970 > expiresAt
    {
      log("VoIP push expired for room \(roomId)")
      reportImmediatelyEndedCall(uuid: uuid, reason: .unanswered) { completion() }
      return
    }

    log("VoIP push received for room \(roomId)")
    let expiresAt = dict["expires_at"] as? TimeInterval
    reportIncomingCall(
      uuid: uuid, callerName: callerName, roomId: roomId,
      hasVideo: dict["has_video"] as? Bool ?? false,
      notificationEventId: dict["notification_event_id"] as? String
    ) { [weak self] error in
      completion()
      guard error == nil, let expiresAt else { return }
      DispatchQueue.main.asyncAfter(
        deadline: .now() + max(0, expiresAt - Date().timeIntervalSince1970)
      ) {
        guard let self, self.incomingPayloads[uuid] != nil,
          !self.answeredCalls.contains(uuid)
        else { return }
        self.endCall(callId: uuid.uuidString, remoteEnded: true, reason: .unanswered)
      }
    }
  }
}

// MARK: - CXProviderDelegate

extension CallKitController: CXProviderDelegate {

  func providerDidReset(_ provider: CXProvider) {
    guard !callKitDisabled, provider === self.provider else { return }
    // CXProvider.h on providerDidReset: "Delegates must respond to this
    // callback by cleaning up all internal call state (disconnecting
    // communication channels, releasing network resources, etc.). This
    // callback can be treated as a request to end all calls without the need
    // to respond to any actions."
    //
    // So nothing is reported back through the reset provider and no deferred
    // action is fulfilled or failed: their calls no longer exist, and every
    // queued startup action targets UUIDs the system has dropped.
    providerReady = false
    setEngine(.none, reason: "CallKit provider reset")

    // "Disconnecting communication channels, releasing network resources" is
    // the room itself, so it is torn down here rather than left running against
    // a call the system no longer knows about.
    let liveCallIds = Set(callByUUID.values)
    discardCallState()
    Task { @MainActor [weak self] in
      for callId in liveCallIds {
        await self?.roomController?.tearDownForSystemEnd(callId: callId)
      }
    }

    // Whether a reset provider ever delivers providerDidBegin again is not
    // documented, and without that signal every queued action would stall
    // forever, so the provider is replaced. CXProvider.h requires invalidating
    // a provider before releasing it.
    //
    // Bounded because a replacement can be reset straight away (the simulator
    // does exactly that, having no telephony stack), and rebuilding on every
    // reset would then spin forever. Past the cap CallKit simply stays
    // unavailable and calls settle with `.unavailable`.
    if providerRebuilds < Self.maxProviderRebuilds {
      providerRebuilds += 1
      provider.invalidate()
      self.provider = CXProvider(configuration: Self.makeProviderConfiguration())
      self.provider?.setDelegate(self, queue: nil)
      log("providerDidReset: state cleared, provider rebuilt (\(providerRebuilds))")
    } else {
      log("providerDidReset: rebuild limit reached, CallKit stays unavailable")
    }

    // Notify JS with an end event so it can clean up its state.
    triggerToJS("callkit_event", data: .end(uuid: ""))
  }

  func providerDidBegin(_ provider: CXProvider) {
    guard !callKitDisabled, provider === self.provider else { return }
    providerReady = true
    log("CXProvider did begin: ready to process Calls")

    // Drain all pending startup actions queued before providerReady.
    let actions = pendingStartupActions
    pendingStartupActions.removeAll()
    for action in actions { action() }

    do {
      try plugin?.trigger("providerReady", data: [:] as [String: String])
    } catch {
      log("trigger providerReady error: \(error.localizedDescription)")
    }
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    guard !callKitDisabled, provider === self.provider else {
      action.fail()
      return
    }
    // Re-gate audio engine before the call starts (prevents wrong-timing activation).
    setEngine(.none, reason: "outgoing call starting")

    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())

    action.fulfill(withDateStarted: Date())

    // Report call update after fulfillment.
    let callUpdate = CXCallUpdate()
    callUpdate.remoteHandle = action.handle
    callUpdate.hasVideo = action.isVideo
    callUpdate.localizedCallerName = action.contactIdentifier
    provider.reportCall(with: action.callUUID, updated: callUpdate)

    log("Outgoing call started for \(action.callUUID)")
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard !callKitDisabled, provider === self.provider else {
      action.fail()
      return
    }
    let uuid = action.callUUID
    answeredCalls.insert(uuid)

    // Re-gate audio engine before activation.
    setEngine(.none, reason: "answering call")

    // Determine source: app-initiated answers fulfill immediately;
    // system-initiated answers defer until JS confirms room connection.
    if appRequestedActions.remove(uuid) != nil {
      // App-initiated: JS pre-answered via answerSystemCall.
      ignoreFirstUnmuteAfterRemoteAnswer = true
      action.fulfill(withDateConnected: Date())
      log("App-initiated answer fulfilled for \(uuid)")
    } else {
      // System-initiated: defer fulfillment, JS fulfills via fulfillAnswerCall.
      // The push payload rides along so a host resuming from a suspended
      // webview knows which room this UUID belongs to.
      ignoreFirstUnmuteAfterRemoteAnswer = true
      pendingAnswerActions[uuid] = (action: action, enqueuedAt: .now())
      let payload = incomingPayloads[uuid]
      let answerAction = SystemCallAction.answer(
        uuid: uuid.uuidString, roomId: payload?.roomId, callerName: payload?.callerName,
        notificationEventId: payload?.notificationEventId, hasVideo: payload?.hasVideo)
      enqueue(answerAction)
      triggerToJS("callkit_event", data: answerAction)
      // Safety timer: auto-fail if JS never responds within 30s.
      DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
        guard let self else { return }
        if let pending = self.pendingAnswerActions.removeValue(forKey: uuid) {
          pending.action.fail()
          log("Auto-failed pending answer for \(uuid) after 30s timeout")
        }
      }
      log("System-initiated answer deferred for \(uuid)")
    }
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard !callKitDisabled, provider === self.provider else {
      action.fail()
      return
    }
    let uuid = action.callUUID

    if appRequestedActions.remove(uuid) != nil {
      // App-initiated: JS pre-ended via endSystemCall or a local/remote hangup.
      #if !targetEnvironment(simulator)
      action.fulfill(withDateEnded: Date())
      #endif
      log("App-initiated end fulfilled for \(uuid)")
    } else {
      // System-initiated (e.g. declined from the lock screen). The webview may
      // be suspended, so the native side tears the room down itself and
      // fulfills as soon as that returns instead of waiting on a JS round trip
      // that may never arrive. The action is still published so JS can
      // reconcile whenever it resumes.
      let endedCallId = callByUUID[uuid]
      let payload = incomingPayloads[uuid]
      let endAction = SystemCallAction.end(
        uuid: uuid.uuidString, roomId: payload?.roomId,
        notificationEventId: answeredCalls.contains(uuid) ? nil : payload?.notificationEventId)
      enqueue(endAction)
      triggerToJS("callkit_event", data: endAction)
      setEngine(.none, reason: "system-initiated end")
      forget(uuid: uuid)
      Task { @MainActor [weak self] in
        if let endedCallId {
          await self?.roomController?.tearDownForSystemEnd(callId: endedCallId)
        }
        action.fulfill(withDateEnded: Date())
        log("System-initiated end fulfilled for \(uuid)")
      }
    }
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    guard !callKitDisabled, provider === self.provider else {
      action.fail()
      return
    }
    let uuid = action.callUUID

    // ignoreFirstUnmuteAfterRemoteAnswer: skip the first unmute arriving
    // after a remote answer to suppress a transient system-UI echo.
    if ignoreFirstUnmuteAfterRemoteAnswer, !action.isMuted {
      ignoreFirstUnmuteAfterRemoteAnswer = false
      action.fulfill()
      log("Ignored first unmute after remote answer for \(uuid)")
      return
    }
    ignoreFirstUnmuteAfterRemoteAnswer = false

    let isAppInitiated = appInitiatedMuteActionIds.remove(action.uuid) != nil
    if isAppInitiated {
      lastAppRequestedMute = action.isMuted
    }
    let isEcho = !isAppInitiated && lastAppRequestedMute == action.isMuted
    if !isAppInitiated && !isEcho {
      enqueue(.mute(uuid: uuid.uuidString, muted: action.isMuted))
      triggerToJS("callkit_event", data: .mute(uuid: uuid.uuidString, muted: action.isMuted))
    }
    action.fulfill()
    log("CXSetMutedCallAction fulfill: appInitiated=\(isAppInitiated) echo=\(isEcho) muted=\(action.isMuted)")
  }

  /// Reachable even though every `CXCallUpdate` sets `supportsHolding = false`:
  /// that flag governs the hold/swap affordance offered for the call, while
  /// Apple documents hold as something the system can impose on its own.
  /// CXSetHeldCallAction: "When the user or the system places a call on hold,
  /// the provider sends provider(_:perform:) to its delegate."
  /// (https://developer.apple.com/documentation/callkit/cxsetheldcallaction)
  /// Dropping this handler would leave such a call held with nothing to resume
  /// it.
  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    guard !callKitDisabled, provider === self.provider else {
      action.fail()
      return
    }
    let uuid = action.callUUID
    if action.isOnHold {
      // The engine is suspended rather than left running into an audio session
      // the system has taken away for whatever interrupted the call.
      setEngine(.none, reason: "call placed on hold")
      action.fulfill()
      log("CXSetHeldCallAction fulfill: onHold=true for \(uuid)")
    } else {
      // The engine is not restarted here. CallKit re-activates the session on
      // resume and `provider(_:didActivate:)` is the single place allowed to
      // restart the engine; doing it here would run the engine against a
      // session that is not active yet.
      action.fulfill()
      log("CXSetHeldCallAction fulfill: onHold=false (resume) for \(uuid)")
    }
  }

  func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
    guard !callKitDisabled, provider === self.provider else { return }
    // CXProvider.h: "Called when an action was not performed in time and has
    // been inherently failed. [...] An action that has already timed out should
    // not be fulfilled or failed by the provider delegate." So this only drops
    // any deferred copy, which would otherwise be fulfilled later by JS.
    if let callAction = action as? CXCallAction {
      pendingAnswerActions.removeValue(forKey: callAction.callUUID)
      pendingEndActions.removeValue(forKey: callAction.callUUID)
    }
    log("CXAction timed out: \(action)")
  }

  // MARK: Audio session arbitration (the critical LiveKit recipe)

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    guard !callKitDisabled, provider === self.provider else { return }
    // CallKit activated the system audio session, so this is the only place
    // that may start LiveKit's engine (capture/playback), inside the
    // system-managed window. The engine only starts once the category has
    // actually been applied: starting it against an unconfigured session
    // produces a broken route, and the next activation retries from scratch.
    guard applyAudioSessionMode() else {
      log("CallKit audio session activated but not configured: engine stays suspended")
      return
    }
    guard setEngine(.default, reason: "CallKit activated the audio session") else { return }

    DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
    log("CallKit audio session activated, engine enabled, idle timer disabled")
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    guard !callKitDisabled, provider === self.provider else { return }
    // CallKit ended the audio window: suspend the LiveKit engine immediately.
    setEngine(.none, reason: "CallKit deactivated the audio session")
    DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false }
    log("CallKit audio session deactivated, engine suspended, idle timer re-enabled")
  }
}

// MARK: - SystemCallAction (trigger payload)

/// Bounded action vocabulary sent from native to JS via `trigger`.
enum SystemCallActionKind: String, Codable {
  case answer
  case end
  case mute
}

struct SystemCallAction: Codable {
  let action: SystemCallActionKind
  let uuid: String
  let muted: Bool?  // only meaningful for .mute
  let roomId: String?
  let callerName: String?
  let notificationEventId: String?
  let hasVideo: Bool?

  static func answer(
    uuid: String, roomId: String? = nil, callerName: String? = nil,
    notificationEventId: String? = nil, hasVideo: Bool? = nil
  ) -> Self {
    Self(
      action: .answer, uuid: uuid, muted: nil, roomId: roomId, callerName: callerName,
      notificationEventId: notificationEventId, hasVideo: hasVideo)
  }

  static func end(
    uuid: String, roomId: String? = nil, notificationEventId: String? = nil
  ) -> Self {
    Self(
      action: .end, uuid: uuid, muted: nil, roomId: roomId, callerName: nil,
      notificationEventId: notificationEventId, hasVideo: nil)
  }

  static func mute(uuid: String, muted: Bool) -> Self {
    Self(
      action: .mute, uuid: uuid, muted: muted, roomId: nil, callerName: nil,
      notificationEventId: nil, hasVideo: nil)
  }
}

// MARK: - Logging helper

private func log(_ message: String) {
  #if DEBUG
  NSLog("[CallKitController] \(message)")
  #endif
}
