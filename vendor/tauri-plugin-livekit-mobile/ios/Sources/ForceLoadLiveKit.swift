import LiveKit

// Workaround for ld64's lazy archive-member extraction dropping ObjC-visible
// class extensions from a static library (Swift SR-14217 / Apple QA1490).
//
// `Room.add(delegate:)` and friends are declared in a *class extension*
// (`extension Room: MulticastDelegateProtocol`) in
// `Room+MulticastDelegate.swift`; incremental SwiftPM builds emit their
// ObjC-side method list as a separate archive member. Cross-module callers
// (including LiveKit's own `MetricsManager.register(room:)`) send
// `addDelegate:` through `objc_msgSend`, which references only the selector
// string, never a symbol. The linker hence never extracts the member, and the
// binary crashes with
//   `-[LiveKit.Room addDelegate:]: unrecognized selector sent to instance`
// as soon as a Room is constructed. The same fate can hit the
// `allParticipants` ObjC exposure from `Room+Convenience.swift`, and the
// Participant/Track delegate pairs.
//
// The documented fix (`-ObjC` in OTHER_LDFLAGS, per Apple QA1490 and Swift
// SR-14217) is not usable here: the plugin's archive embeds its own copy of
// the Tauri Swift API next to the app's, and `-ObjC` force-loads both
// (verified: 428 duplicate symbols at link time). Instead, this file emits
// plain *symbol* references to the affected members; the linker then pulls
// exactly those members out of the archive and nothing else.
//
/// Emits undefined-symbol references to the members above. Called once from
/// the plugin's `load(webview:)` (a member the host always links); at runtime
/// the function only materializes function values; nothing is called.
@inline(never)
@discardableResult
func forceLinkLiveKitObjCSurface() -> Int {
  let refs: [Any] = [
    Room.add,
    Room.remove,
    { (room: Room) in room.allParticipants },
    Participant.add,
    Participant.remove,
    Track.add,
    Track.remove,
    VideoCapturer.add,
    VideoCapturer.remove,
    VideoView.add,
    VideoView.remove,
  ]
  return refs.count
}
