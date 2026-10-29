import Foundation
import LiveKit
import Tauri
import UIKit
import XCTest

@testable import tauri_plugin_livekit_mobile

/// Pins the Rust-facing JSON contract of the bridge: the authoritative
/// snapshot shape (explicit `callId: null`, omitted `lastError`, camera flag),
/// the single `snapshot_changed` channel event, bounded enum values, and
/// invoke settlement guarantees. No LiveKit connection is established here;
/// plugin commands are driven through a headless `Invoke`.
final class WireContractTests: XCTestCase {

  // MARK: - Helpers

  private func jsonObject(_ value: Encodable) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    return try XCTUnwrap(
      JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  private func jsonObject(_ payload: String) throws -> [String: Any] {
    try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any])
  }

  private static func idleSnapshot(
    revision: UInt64 = 0,
    microphoneEnabled: Bool = false,
    cameraEnabled: Bool = false
  ) -> BridgeStateResponse {
    BridgeStateResponse(
      revision: revision, callId: nil, connectionState: .idle,
      microphoneEnabled: microphoneEnabled, cameraEnabled: cameraEnabled,
      screenShareEnabled: false, participantCount: 0, remoteParticipants: [],
      lastError: nil, localConnectionQuality: nil)
  }

  /// Asserts the full snapshot keys exactly as the bridge contract requires.
  private func assertSnapshotKeys(
    _ state: [String: Any], revision: Int = 0, callId: String?,
    connectionState: String, microphoneEnabled: Bool, cameraEnabled: Bool,
    screenShareEnabled: Bool = false,
    participantCount: Int, remoteParticipantCount: Int = 0,
    file: StaticString = #filePath, line: UInt = #line
  ) throws {
    XCTAssertEqual(state["revision"] as? Int, revision, file: file, line: line)
    if let callId {
      XCTAssertEqual(state["callId"] as? String, callId, file: file, line: line)
    } else {
      XCTAssertTrue(state["callId"] is NSNull, "callId must be explicit null", file: file, line: line)
    }
    XCTAssertEqual(state["connectionState"] as? String, connectionState, file: file, line: line)
    XCTAssertEqual(state["microphoneEnabled"] as? Bool, microphoneEnabled, file: file, line: line)
    XCTAssertEqual(state["cameraEnabled"] as? Bool, cameraEnabled, file: file, line: line)
    XCTAssertEqual(
      state["screenShareEnabled"] as? Bool, screenShareEnabled, file: file, line: line)
    XCTAssertEqual(state["participantCount"] as? Int, participantCount, file: file, line: line)
    let participants = try XCTUnwrap(
      state["remoteParticipants"] as? [[String: Any]],
      "remoteParticipants must always be present", file: file, line: line)
    XCTAssertEqual(
      participants.count, remoteParticipantCount, file: file, line: line)
  }

  private final class InvokeRecording: @unchecked Sendable {
    private typealias InvokeResponse = (id: UInt64, payload: String?)

    private let lock = NSLock()
    private var recorded: InvokeResponse?
    private var continuation: CheckedContinuation<InvokeResponse, Never>?

    func record(_ id: UInt64, _ payload: String?) {
      lock.lock()
      if let continuation {
        self.continuation = nil
        lock.unlock()
        continuation.resume(returning: (id, payload))
      } else {
        recorded = (id, payload)
        lock.unlock()
      }
    }

    func wait() async -> (id: UInt64, payload: String?) {
      await withCheckedContinuation { continuation in
        lock.lock()
        if let recorded {
          self.recorded = nil
          lock.unlock()
          continuation.resume(returning: recorded)
        } else {
          self.continuation = continuation
          lock.unlock()
        }
      }
    }
  }

  private static let resolveId: UInt64 = 1
  private static let rejectId: UInt64 = 2

  private func makeInvoke(data: String) -> (Invoke, InvokeRecording) {
    let recording = InvokeRecording()
    let invoke = Invoke(
      command: "test",
      callback: Self.resolveId,
      error: Self.rejectId,
      sendResponse: { id, payload in recording.record(id, payload) },
      sendChannelData: { _, _ in },
      data: data)
    return (invoke, recording)
  }

  func testPushedInvitationIdentitySurvivesSystemActions() throws {
    let answer = try jsonObject(
      SystemCallAction.answer(
        uuid: "system-uuid", roomId: "!room:example.org", callerName: "Caller",
        notificationEventId: "$invite", hasVideo: true))
    XCTAssertEqual(answer["notificationEventId"] as? String, "$invite")
    XCTAssertEqual(answer["hasVideo"] as? Bool, true)
    let decline = try jsonObject(
      SystemCallAction.end(
        uuid: "system-uuid", roomId: "!room:example.org", notificationEventId: "$invite"))
    XCTAssertEqual(decline["roomId"] as? String, "!room:example.org")
    XCTAssertEqual(decline["notificationEventId"] as? String, "$invite")
    let end = try jsonObject(SystemCallAction.end(uuid: "system-uuid"))
    XCTAssertNil(end["notificationEventId"])
  }

  // MARK: - Bounded wire values

  func testConnectionStateWireValues() throws {
    for (state, raw) in [
      (BridgeConnectionState.idle, "idle"),
      (.connecting, "connecting"),
      (.connected, "connected"),
      (.reconnecting, "reconnecting"),
      (.failed, "failed"),
    ] as [(BridgeConnectionState, String)] {
      let value = try XCTUnwrap(
        String(data: JSONEncoder().encode(state), encoding: .utf8))
      XCTAssertEqual(value, "\"\(raw)\"")
    }
  }

  func testFailureCodeRawValuesAreThePublicBoundedSet() {
    XCTAssertEqual(BridgeFailureCode.invalidRequest.rawValue, "invalid_request")
    XCTAssertEqual(BridgeFailureCode.busy.rawValue, "busy")
    XCTAssertEqual(BridgeFailureCode.permissionDenied.rawValue, "permission_denied")
    XCTAssertEqual(BridgeFailureCode.connectFailed.rawValue, "connect_failed")
    XCTAssertEqual(BridgeFailureCode.mediaFailed.rawValue, "media_failed")
    XCTAssertEqual(BridgeFailureCode.disconnected.rawValue, "disconnected")
    XCTAssertEqual(BridgeFailureCode.cancelled.rawValue, "cancelled")
    XCTAssertEqual(BridgeFailureCode.unavailable.rawValue, "unavailable")
    XCTAssertEqual(BridgeFailureCode.unexpected.rawValue, "unexpected")
  }

  // MARK: - Snapshot shape

  func testIdleSnapshotShape() throws {
    let state = try jsonObject(Self.idleSnapshot())
    try assertSnapshotKeys(
      state, revision: 0, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
    XCTAssertNil(state["lastError"])
  }

  func testSnapshotCarriesMediaFlagsAndBoundedLastError() throws {
    let state = try jsonObject(
      BridgeStateResponse(
        revision: 7, callId: "call-1", connectionState: .connected,
        microphoneEnabled: true, cameraEnabled: true, screenShareEnabled: true,
        participantCount: 2,
        remoteParticipants: [
          BridgeRemoteParticipant(
            identity: "alice",
            camera: BridgeRemoteCamera(sid: "TR_VC1", muted: false, subscribed: true),
            screenShare: BridgeRemoteScreenShare(
              sid: "TR_SS1", muted: false, subscribed: true),
            microphone: BridgeRemoteMicrophone(
              sid: "TR_MIC1", muted: true, subscribed: true),
            connectionQuality: .excellent),
          BridgeRemoteParticipant(
            identity: "bob", camera: nil, screenShare: nil, microphone: nil,
            connectionQuality: nil),
        ],
        lastError: BridgeError(.mediaFailed), localConnectionQuality: .good))
    try assertSnapshotKeys(
      state, revision: 7, callId: "call-1", connectionState: "connected",
      microphoneEnabled: true, cameraEnabled: true, screenShareEnabled: true,
      participantCount: 2, remoteParticipantCount: 2)
    XCTAssertEqual(state["localConnectionQuality"] as? String, "good")
    let participants = try XCTUnwrap(state["remoteParticipants"] as? [[String: Any]])

    let alice = participants[0]
    XCTAssertEqual(alice["identity"] as? String, "alice")
    let camera = try XCTUnwrap(alice["camera"] as? [String: Any])
    XCTAssertEqual(camera["sid"] as? String, "TR_VC1")
    XCTAssertEqual(camera["muted"] as? Bool, false)
    XCTAssertEqual(camera["subscribed"] as? Bool, true)
    let screenShare = try XCTUnwrap(alice["screenShare"] as? [String: Any])
    XCTAssertEqual(screenShare["sid"] as? String, "TR_SS1")
    XCTAssertEqual(screenShare["muted"] as? Bool, false)
    XCTAssertEqual(screenShare["subscribed"] as? Bool, true)
    let microphone = try XCTUnwrap(alice["microphone"] as? [String: Any])
    XCTAssertEqual(microphone["sid"] as? String, "TR_MIC1")
    XCTAssertEqual(microphone["muted"] as? Bool, true)
    XCTAssertEqual(microphone["subscribed"] as? Bool, true)
    XCTAssertEqual(alice["connectionQuality"] as? String, "excellent")

    // `camera`, `screenShare`, `microphone` and `connectionQuality` are
    // omitted (not null) when the participant has no such publication or no
    // known quality.
    let bob = participants[1]
    XCTAssertEqual(bob["identity"] as? String, "bob")
    XCTAssertNil(bob["camera"])
    XCTAssertNil(bob["screenShare"])
    XCTAssertNil(bob["microphone"])
    XCTAssertNil(bob["connectionQuality"])
    // The projection never carries names or metadata.
    XCTAssertNil(alice["name"])
    XCTAssertNil(alice["metadata"])

    let lastError = try XCTUnwrap(state["lastError"] as? [String: Any])
    XCTAssertEqual(lastError["code"] as? String, "media_failed")
    XCTAssertEqual(
      lastError["message"] as? String, BridgeFailureCode.mediaFailed.message)
    // The error payload must never carry secrets or environment details.
    XCTAssertNil(lastError["token"])
    XCTAssertNil(lastError["url"])
    XCTAssertNil(lastError["error"])
  }

  // MARK: - Channel event shape

  func testSnapshotChangedEventCarriesFullSnapshot() throws {
    let event = try jsonObject(
      BridgeSnapshotEvent(event: .snapshotChanged, snapshot: Self.idleSnapshot(revision: 4)))
    XCTAssertEqual(event["event"] as? String, "snapshot_changed")
    let snapshot = try XCTUnwrap(event["snapshot"] as? [String: Any])
    try assertSnapshotKeys(
      snapshot, revision: 4, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
    XCTAssertNil(snapshot["lastError"])
    // No legacy fields may leak into the single-protocol event.
    XCTAssertNil(event["callId"])
    XCTAssertNil(event["connectionState"])
    XCTAssertNil(event["code"])
    XCTAssertNil(event["message"])
    XCTAssertNil(event["participantCount"])
    XCTAssertNil(event["remoteParticipants"])
  }

  func testEventKindRawValue() {
    XCTAssertEqual(BridgeEventKind.snapshotChanged.rawValue, "snapshot_changed")
  }

  // MARK: - Args decoding

  func testConnectArgsDecodeCamelCase() throws {
    let (invoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": true,
        "channel": "__CHANNEL__:7"
      }
      """)
    let args = try invoke.parseArgs(ConnectArgs.self)
    XCTAssertEqual(args.callId, "call-1")
    XCTAssertEqual(args.url, "wss://example.test")
    XCTAssertEqual(args.token, "T0K3N")
    XCTAssertTrue(args.microphoneEnabled)
    XCTAssertEqual(try XCTUnwrap(args.channel).id, 7)
    XCTAssertNil(args.callerName)
  }

  func testConnectArgsDecodeCallerName() throws {
    let (invoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": true,
        "channel": "__CHANNEL__:7",
        "callerName": "Room A"
      }
      """)
    let args = try invoke.parseArgs(ConnectArgs.self)
    XCTAssertEqual(args.callerName, "Room A")
  }

  func testConnectArgsDecodeOptionalAudioProcessing() throws {
    // Absent: every effect stays on, which is the SDK's own default.
    let (plainInvoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": true,
        "channel": "__CHANNEL__:7"
      }
      """)
    let plain = try plainInvoke.parseArgs(ConnectArgs.self)
    XCTAssertNil(plain.audioProcessing)

    let (invoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": true,
        "audioProcessing": {
          "echoCancellation": false,
          "noiseSuppression": false,
          "autoGainControl": true
        },
        "channel": "__CHANNEL__:7"
      }
      """)
    let options = try XCTUnwrap(try invoke.parseArgs(ConnectArgs.self).audioProcessing)
      .captureOptions
    XCTAssertFalse(options.echoCancellation)
    XCTAssertFalse(options.noiseSuppression)
    XCTAssertTrue(options.autoGainControl)
  }

  func testAudioProcessingArgsDefaultEveryEffectOn() throws {
    let (invoke, _) = makeInvoke(data: #"{"callId": "call-1", "noiseSuppression": false}"#)
    let args = try invoke.parseArgs(SetAudioProcessingArgs.self)
    XCTAssertEqual(args.callId, "call-1")
    XCTAssertFalse(args.captureOptions.noiseSuppression)
    XCTAssertTrue(args.captureOptions.echoCancellation)
    XCTAssertTrue(args.captureOptions.autoGainControl)
  }

  func testParticipantVolumeArgsDecode() throws {
    let (invoke, _) = makeInvoke(
      data: #"{"callId": "call-1", "identity": "@alice:example.org", "volume": 0.4}"#)
    let args = try invoke.parseArgs(SetParticipantVolumeArgs.self)
    XCTAssertEqual(args.callId, "call-1")
    XCTAssertEqual(args.identity, "@alice:example.org")
    XCTAssertEqual(args.volume, 0.4, accuracy: 0.0001)
    XCTAssertNil(args.screenShare)
  }

  func testScreenShareVolumeArgsDecode() throws {
    let (invoke, _) = makeInvoke(
      data: #"{"callId": "call-1", "identity": "alice", "volume": 0.6, "screenShare": true}"#)
    let args = try invoke.parseArgs(SetParticipantVolumeArgs.self)
    XCTAssertEqual(args.screenShare, true)
    XCTAssertEqual(args.volume, 0.6, accuracy: 0.0001)
  }

  func testCallIdOnlyArgsDecode() throws {
    let (invoke, _) = makeInvoke(data: #"{"callId": "call-1"}"#)
    let args = try invoke.parseArgs(DisconnectArgs.self)
    XCTAssertEqual(args.callId, "call-1")
  }

  func testMediaEnabledArgsDecode() throws {
    let (invoke, _) = makeInvoke(data: #"{"callId": "call-1", "enabled": false}"#)
    let mic = try invoke.parseArgs(SetMicrophoneEnabledArgs.self)
    XCTAssertEqual(mic.callId, "call-1")
    XCTAssertFalse(mic.enabled)
    let camera = try invoke.parseArgs(SetCameraEnabledArgs.self)
    XCTAssertEqual(camera.callId, "call-1")
    XCTAssertFalse(camera.enabled)
  }

  func testConnectArgsDecodeOptionalEncryptionKeys() throws {
    // Absent: the generic (unencrypted) path must keep decoding.
    let (plainInvoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": false,
        "channel": "__CHANNEL__:7"
      }
      """)
    let plain = try plainInvoke.parseArgs(ConnectArgs.self)
    XCTAssertNil(plain.encryptionKeys)

    // Present: identity, key index and base64 key bytes per participant.
    let (invoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": false,
        "channel": "__CHANNEL__:7",
        "encryptionKeys": [
          { "identity": "@alice:example.org", "keyIndex": 0, "key": "AP8=" },
          { "identity": "@bob:example.org", "keyIndex": 5, "key": "MTIz" }
        ]
      }
      """)
    let args = try invoke.parseArgs(ConnectArgs.self)
    let keys = try XCTUnwrap(args.encryptionKeys)
    XCTAssertEqual(keys.count, 2)
    XCTAssertEqual(keys[0].identity, "@alice:example.org")
    XCTAssertEqual(keys[0].keyIndex, 0)
    XCTAssertEqual(keys[0].key, "AP8=")
    XCTAssertEqual(keys[1].identity, "@bob:example.org")
    XCTAssertEqual(keys[1].keyIndex, 5)
    XCTAssertEqual(keys[1].key, "MTIz")
  }

  func testSetEncryptionKeyArgsDecodeCamelCase() throws {
    let (invoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "identity": "@alice:example.org",
        "keyIndex": 7,
        "key": "AP8="
      }
      """)
    let args = try invoke.parseArgs(SetEncryptionKeyArgs.self)
    XCTAssertEqual(args.callId, "call-1")
    XCTAssertEqual(args.identity, "@alice:example.org")
    XCTAssertEqual(args.keyIndex, 7)
    XCTAssertEqual(args.key, "AP8=")
  }

  // MARK: - E2EE key material

  func testDecodeKeyMaterialAbsentOrEmptyMeansUnencrypted() throws {
    XCTAssertTrue(try XCTUnwrap(RoomController.decodeKeyMaterial(from: nil)).isEmpty)
    XCTAssertTrue(try XCTUnwrap(RoomController.decodeKeyMaterial(from: [])).isEmpty)
  }

  func testDecodeKeyMaterialDecodesBase64Keys() throws {
    let material = try XCTUnwrap(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(
          identity: "@alice:example.org", keyIndex: 0, key: "AP8="),
        EncryptionKeyPayload(
          identity: "@bob:example.org", keyIndex: 5, key: "MTIz"),
      ]))
    XCTAssertEqual(material.count, 2)
    XCTAssertEqual(material[0].identity, "@alice:example.org")
    XCTAssertEqual(material[0].keyIndex, 0)
    XCTAssertEqual(material[0].keyData, Data([0x00, 0xFF]))
    XCTAssertEqual(material[1].identity, "@bob:example.org")
    XCTAssertEqual(material[1].keyIndex, 5)
    XCTAssertEqual(material[1].keyData, Data("123".utf8))
  }

  /// Blank identities, negative indexes, undecodable base64, and empty
  /// decoded key bytes all fail the whole decode (matching the Rust gate
  /// and the Android lane) so the caller can reject through the bounded
  /// invalid-request path.
  func testDecodeKeyMaterialRejectsInvalidEntries() throws {
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: "@a:b.c", keyIndex: 0, key: "!!!")
      ]))
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: "@a:b.c", keyIndex: 0, key: "AP8")
      ]))
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: "@a:b.c", keyIndex: -1, key: "AP8=")
      ]))
    // Blank identities: empty and whitespace-only.
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: "", keyIndex: 0, key: "AP8=")
      ]))
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: " \t\n", keyIndex: 0, key: "AP8=")
      ]))
    // Base64 that decodes to zero bytes is not a usable key.
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: "@a:b.c", keyIndex: 0, key: "")
      ]))
    // A single bad entry rejects the payload, even with valid entries.
    XCTAssertNil(
      RoomController.decodeKeyMaterial(from: [
        EncryptionKeyPayload(identity: "@a:b.c", keyIndex: 0, key: "AP8="),
        EncryptionKeyPayload(identity: "@b:c.d", keyIndex: 1, key: "!!"),
      ]))
  }

  /// The per-call provider must match the web lanes: per-participant keys,
  /// HKDF, ratchet window 10, key ring 256, LiveKit default salt/magic, and
  /// raw (non-UTF8) key bytes must round-trip unmodified.
  func testMakeKeyProviderMatchesWebLaneConfiguration() throws {
    let key = Data([0xFF, 0xFE, 0x80, 0x00, 0xDE, 0xAD])
    let material = [
      RoomController.EncryptionKeyMaterial(
        identity: "@alice:example.org", keyIndex: 1, keyData: key),
      RoomController.EncryptionKeyMaterial(
        identity: "@bob:example.org", keyIndex: 200, keyData: Data("bob-key".utf8)),
    ]
    let provider = RoomController.makeKeyProvider(keyMaterial: material)

    let options = provider.options
    XCTAssertFalse(options.sharedKey)
    XCTAssertEqual(options.keyDerivationAlgorithm, .hkdf)
    XCTAssertEqual(options.ratchetWindowSize, 10)
    XCTAssertEqual(options.keyRingSize, 256)
    XCTAssertEqual(options.ratchetSalt, Data(defaultRatchetSalt.utf8))
    XCTAssertEqual(options.uncryptedMagicBytes, Data(defaultMagicBytes.utf8))

    XCTAssertEqual(
      provider.exportKey(participantId: "@alice:example.org", index: 1), key)
    XCTAssertEqual(
      provider.exportKey(participantId: "@bob:example.org", index: 200),
      Data("bob-key".utf8))
  }

  /// A key index selects a slot in the identity's ring, so the last key
  /// installed for an index wins and a lower index is a legitimate update
  /// rather than a stale one: a peer that rejoins restarts back at 0.
  func testKeyRingKeepsTheLastKeyInstalledPerIndex() {
    let provider = RoomController.makeKeyProvider(keyMaterial: [
      RoomController.EncryptionKeyMaterial(
        identity: "@a:b.c", keyIndex: 7, keyData: Data("old".utf8)),
      RoomController.EncryptionKeyMaterial(
        identity: "@a:b.c", keyIndex: 0, keyData: Data("rejoined".utf8)),
    ])

    XCTAssertEqual(
      provider.exportKey(participantId: "@a:b.c", index: 0),
      Data("rejoined".utf8))
    XCTAssertEqual(
      provider.exportKey(participantId: "@a:b.c", index: 7),
      Data("old".utf8))
  }

  /// Every supplied entry for a repeated identity must land on the
  /// provider's key ring (not just the last one).
  func testMakeKeyProviderPreservesRingEntriesForDuplicateIdentity() {
    let first = Data([0xAA])
    let second = Data([0xBB])
    let third = Data([0xCC])
    let provider = RoomController.makeKeyProvider(keyMaterial: [
      RoomController.EncryptionKeyMaterial(
        identity: "@a:b.c", keyIndex: 3, keyData: first),
      RoomController.EncryptionKeyMaterial(
        identity: "@a:b.c", keyIndex: 7, keyData: second),
      RoomController.EncryptionKeyMaterial(
        identity: "@a:b.c", keyIndex: 5, keyData: third),
    ])
    XCTAssertEqual(provider.exportKey(participantId: "@a:b.c", index: 3), first)
    XCTAssertEqual(provider.exportKey(participantId: "@a:b.c", index: 5), third)
    XCTAssertEqual(provider.exportKey(participantId: "@a:b.c", index: 7), second)
  }

  // MARK: - Rotation invoke settlement

  /// A stale call id must never touch key state and resolves the current
  /// snapshot, like the other call-scoped commands.
  func testStaleSetEncryptionKeyIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: """
      {
        "callId": "unknown",
        "identity": "@alice:example.org",
        "keyIndex": 1,
        "key": "AP8="
      }
      """)
    try plugin.setEncryptionKey(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    try assertSnapshotKeys(
      payload, revision: 0, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
  }

  func testMalformedSetEncryptionKeyRejectsInvalidRequest() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(
      data: #"{"callId": "call-1", "identity": "@alice:example.org"}"#)
    try plugin.setEncryptionKey(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.rejectId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["code"] as? String, "invalid_request")
  }

  /// Input is validated before any call-state check (matching the Android
  /// lane's boundary decode): undecodable rotation input rejects
  /// `invalid_request` even when the call id is stale.
  func testSetEncryptionKeyRejectsInvalidInputRegardlessOfCallState() async throws {
    for data in [
      // Bad base64.
      #"{"callId": "unknown", "identity": "@a:b.c", "keyIndex": 0, "key": "!!bad!!"}"#,
      // Blank identity.
      #"{"callId": "unknown", "identity": " ", "keyIndex": 0, "key": "AP8="}"#,
      // Empty decoded key bytes.
      #"{"callId": "unknown", "identity": "@a:b.c", "keyIndex": 0, "key": ""}"#,
      // Negative key index.
      #"{"callId": "unknown", "identity": "@a:b.c", "keyIndex": -1, "key": "AP8="}"#,
    ] {
      let plugin = LivekitMobilePlugin()
      let (invoke, recording) = makeInvoke(data: data)
      try plugin.setEncryptionKey(invoke)
      let response = await recording.wait()
      XCTAssertEqual(response.id, Self.rejectId, data)
      let rawPayload = try XCTUnwrap(response.payload)
      let payload = try jsonObject(rawPayload)
      XCTAssertEqual(payload["code"] as? String, "invalid_request", data)
      XCTAssertFalse(rawPayload.contains("key"), data)
    }
  }

  /// A stale rotation carries key material through the reject-safe no-op
  /// path; the resolved snapshot must never echo any of it.
  func testStaleSetEncryptionKeyResolvesWithoutEchoingKey() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: """
      {
        "callId": "call-1",
        "identity": "@alice:example.org",
        "keyIndex": 3,
        "key": "c2VjcmV0LWtleS1ieXRlcw=="
      }
      """)
    try plugin.setEncryptionKey(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let rawPayload = try XCTUnwrap(response.payload)
    XCTAssertFalse(rawPayload.contains("c2VjcmV0LWtleS1ieXRlcw=="))
    XCTAssertFalse(rawPayload.contains("keyIndex"))
    XCTAssertFalse(rawPayload.contains("alice"))
  }

  /// Malformed base64 in connect rejects without echoing the key material.
  func testMalformedConnectEncryptionKeyRejectsWithoutEchoing() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: """
      {
        "callId": "call-1",
        "url": "wss://example.test",
        "token": "T0K3N",
        "microphoneEnabled": false,
        "channel": "__CHANNEL__:7",
        "encryptionKeys": [
          { "identity": "@alice:example.org", "keyIndex": 0, "key": "!!not-base64!!" }
        ]
      }
      """)
    try plugin.connect(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.rejectId)
    let rawPayload = try XCTUnwrap(response.payload)
    let payload = try jsonObject(rawPayload)
    XCTAssertEqual(payload["code"] as? String, "invalid_request")
    XCTAssertFalse(rawPayload.contains("not-base64"))
    // A rejected decode must not disturb state: no revision bump, still idle.
    let (stateInvoke, stateRecording) = makeInvoke(data: "{}")
    try plugin.getState(stateInvoke)
    let stateResponse = await stateRecording.wait()
    let statePayload = try jsonObject(try XCTUnwrap(stateResponse.payload))
    try assertSnapshotKeys(
      statePayload, revision: 0, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
  }

  func testSetRemoteVideoOverlayArgsDecodeCamelCase() throws {
    let (invoke, _) = makeInvoke(data: """
      {
        "callId": "call-1",
        "participantIdentity": "@alice:example.org",
        "trackId": "TR_VC1",
        "x": 10.5,
        "y": 20.25,
        "width": 320.0,
        "height": 180.0,
        "devicePixelRatio": 3.0
      }
      """)
    let args = try invoke.parseArgs(SetRemoteVideoOverlayArgs.self)
    XCTAssertEqual(args.callId, "call-1")
    XCTAssertEqual(args.participantIdentity, "@alice:example.org")
    XCTAssertEqual(args.trackId, "TR_VC1")
    XCTAssertEqual(args.x, 10.5)
    XCTAssertEqual(args.y, 20.25)
    XCTAssertEqual(args.width, 320.0)
    XCTAssertEqual(args.height, 180.0)
    XCTAssertEqual(args.devicePixelRatio, 3.0)
  }

  func testClearRemoteVideoOverlayArgsDecodeOptionalTrack() throws {
    let (one, _) = makeInvoke(data: #"{"callId": "call-1", "trackId": "TR_VC1"}"#)
    XCTAssertEqual(try one.parseArgs(ClearRemoteVideoOverlayArgs.self).trackId, "TR_VC1")
    let (all, _) = makeInvoke(data: #"{"callId": "call-1"}"#)
    XCTAssertNil(try all.parseArgs(ClearRemoteVideoOverlayArgs.self).trackId)
  }

  // MARK: - Invoke settlement

  func testCapabilitiesResolves() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: "{}")
    try plugin.capabilities(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["microphone"] as? Bool, true)
    XCTAssertEqual(payload["backgroundAudio"] as? Bool, true)
    XCTAssertEqual(payload["camera"] as? Bool, true)
    XCTAssertEqual(payload["nativeVideoOverlay"] as? Bool, true)
  }

  func testGetStateResolvesIdleSnapshot() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: "{}")
    try plugin.getState(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    try assertSnapshotKeys(
      payload, revision: 0, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
  }

  func testStaleDisconnectIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: #"{"callId": "unknown"}"#)
    try plugin.disconnect(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["connectionState"] as? String, "idle")
    XCTAssertTrue(payload["callId"] is NSNull)
  }

  /// Timeout recovery on an idle controller must resolve the idle snapshot,
  /// never reject, and never disturb state.
  func testCancelConnectOnIdleIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: #"{"callId": "unknown"}"#)
    try plugin.cancelConnect(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    try assertSnapshotKeys(
      payload, revision: 0, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
  }

  func testStaleSetMicrophoneIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(
      data: #"{"callId": "unknown", "enabled": true}"#)
    try plugin.setMicrophoneEnabled(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["connectionState"] as? String, "idle")
    XCTAssertEqual(payload["microphoneEnabled"] as? Bool, false)
    XCTAssertEqual(payload["cameraEnabled"] as? Bool, false)
  }

  func testStaleSetCameraIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(
      data: #"{"callId": "unknown", "enabled": true}"#)
    try plugin.setCameraEnabled(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["connectionState"] as? String, "idle")
    XCTAssertEqual(payload["cameraEnabled"] as? Bool, false)
  }

  func testStaleSwitchCameraIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: #"{"callId": "unknown"}"#)
    try plugin.switchCamera(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["connectionState"] as? String, "idle")
  }

  /// The overlay frame converts the viewport-relative CSS rect through the
  /// view hierarchy (CSS pixels map 1:1 to logical points, the device pixel
  /// ratio is never applied) and clips it to the webview's bounds. The helper
  /// is MainActor-isolated because UIView geometry is main-thread state.
  @MainActor
  func testOverlayFrameConvertsAndClipsToWebViewBounds() {
    let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let webView = UIView(frame: CGRect(x: 0, y: 100, width: 390, height: 600))
    container.addSubview(webView)

    // Fully inside: converted by the webview's geometry, unclipped.
    let visible = RoomController.overlayFrame(
      viewportRect: CGRect(x: 10.5, y: 20.25, width: 320, height: 180),
      in: webView, container: container)
    XCTAssertEqual(visible, CGRect(x: 10.5, y: 120.25, width: 320, height: 180))

    // A negative origin is legal for partially off-screen tiles; the frame is
    // clipped to the webview's bounds.
    let clipped = RoomController.overlayFrame(
      viewportRect: CGRect(x: -40, y: 500, width: 320, height: 180),
      in: webView, container: container)
    XCTAssertEqual(clipped, CGRect(x: 0, y: 600, width: 280, height: 100))

    // A tile that only intersects along an edge is as good as invisible.
    let edgeOnly = RoomController.overlayFrame(
      viewportRect: CGRect(x: -40, y: 0, width: 40, height: 180),
      in: webView, container: container)
    XCTAssertNil(edgeOnly)

    // Fully off-screen: no overlay frame, the command rejects.
    XCTAssertNil(
      RoomController.overlayFrame(
        viewportRect: CGRect(x: 0, y: 700, width: 320, height: 180),
        in: webView, container: container))
  }

  /// Partially off-screen tiles are valid (negative origin allowed), while
  /// size and pixel ratio must be finite and positive.
  func testOverlayGeometryValidationBounds() {
    XCTAssertTrue(
      RoomController.overlayGeometryIsValid(
        CGRect(x: -40, y: -10, width: 320, height: 180), devicePixelRatio: 3))
    XCTAssertTrue(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: 320, height: 180), devicePixelRatio: 1))
    // Non-positive or non-finite sizes are rejected.
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: 0, height: 180), devicePixelRatio: 3))
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: 320, height: -1), devicePixelRatio: 3))
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: Double.nan, height: 180), devicePixelRatio: 3))
    // Non-finite origins are rejected.
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: Double.infinity, y: 0, width: 320, height: 180), devicePixelRatio: 3))
    // The pixel ratio is validated even though iOS never applies it.
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: 320, height: 180), devicePixelRatio: 0))
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: 320, height: 180), devicePixelRatio: -2))
    XCTAssertFalse(
      RoomController.overlayGeometryIsValid(
        CGRect(x: 0, y: 0, width: 320, height: 180), devicePixelRatio: .nan))
  }

  /// A stale call id must never touch overlay state (there may be none), and
  /// resolves the current snapshot like the other call-scoped commands.
  func testStaleSetRemoteVideoOverlayIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: """
      {
        "callId": "unknown",
        "participantIdentity": "@alice:example.org",
        "trackId": "TR_VC1",
        "x": 0.0,
        "y": 0.0,
        "width": 320.0,
        "height": 180.0,
        "devicePixelRatio": 2.0
      }
      """)
    try plugin.setRemoteVideoOverlay(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    try assertSnapshotKeys(
      payload, revision: 0, callId: nil, connectionState: "idle",
      microphoneEnabled: false, cameraEnabled: false, participantCount: 0)
  }

  func testStaleClearRemoteVideoOverlayIsNoOpResolve() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: #"{"callId": "unknown"}"#)
    try plugin.clearRemoteVideoOverlay(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.resolveId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["connectionState"] as? String, "idle")
    XCTAssertTrue(payload["callId"] is NSNull)
  }

  func testBlankTrackClearRemoteVideoOverlayRejectsInvalidRequest() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: #"{"callId": "call-1", "trackId": " "}"#)
    try plugin.clearRemoteVideoOverlay(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.rejectId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["code"] as? String, "invalid_request")
  }

  func testMalformedSetRemoteVideoOverlayRejectsInvalidRequest() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(
      data: #"{"callId": "call-1", "participantIdentity": "@alice:example.org"}"#)
    try plugin.setRemoteVideoOverlay(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.rejectId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["code"] as? String, "invalid_request")
  }

  func testMalformedSetCameraRejectsInvalidRequest() async throws {
    let plugin = LivekitMobilePlugin()
    let (invoke, recording) = makeInvoke(data: #"{"callId": "call-1"}"#)
    try plugin.setCameraEnabled(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.rejectId)
    let payload = try jsonObject(try XCTUnwrap(response.payload))
    XCTAssertEqual(payload["code"] as? String, "invalid_request")
  }

  /// A malformed connect (realistic JWT-looking token included) must reject
  /// with the bounded `invalid_request` code and must never echo the token.
  func testMalformedConnectRejectsWithoutEchoingToken() async throws {
    let plugin = LivekitMobilePlugin()
    let secret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.9fakedata.signature"
    let (invoke, recording) = makeInvoke(
      data: """
        { "callId": "call-1", "url": "wss://example.test", "token": "\(secret)" }
        """)
    try plugin.connect(invoke)
    let response = await recording.wait()
    XCTAssertEqual(response.id, Self.rejectId)
    let rawPayload = try XCTUnwrap(response.payload)
    let payload = try jsonObject(rawPayload)
    XCTAssertEqual(payload["code"] as? String, "invalid_request")
    XCTAssertEqual(
      payload["message"] as? String, BridgeFailureCode.invalidRequest.message)
    XCTAssertFalse(rawPayload.contains(secret))
  }
}
