# iOS notifications

`SableNotificationService` links `sable-push` and shares
`group.<bundle identifier>/Sable` with the app, using a separate SDK lock owner.
Decryption checks account/preview policy and times out after 20 seconds. Failure
uses a generic alert, never older plaintext. All alerts follow the sound setting.

Alerts match Android: the room name (or sender) is the title and the body is
`Sender: text`; hidden previews keep the title with a generic body. Messages use the
`sable-message` category (Reply, Mark as read) and are donated as incoming
`INSendMessageIntent`s for communication notifications. Invites read "New Invitation"
with the `sable-invite` category (Accept, Decline). Both categories are declared in
`plugins.notifications.actionTypes`. A push with `counts.unread == 0` closes the
delivered alerts of its room, or of the account when it names no room, if "clear on
read" is on.

## Setup (Apple account required)

1. Register both bundle IDs with one team; enable app Push Notifications and a
   shared App Group. iOS builds use `moe.sable.app` (`src-tauri/tauri.ios.conf.json`),
   so the IDs are `moe.sable.app` and `moe.sable.app.notifications`, and the group is
   `group.moe.sable.app`. Android and desktop keep `moe.sable.next`.
2. Configure gateway APNs credentials and `pushNotificationDetails.iosPushAppID`.
   Match the signing environment: TestFlight uses production, development uses sandbox.
3. Send generic `aps.alert`, `aps.mutable-content: 1`, the Matrix event,
   recipient `user_id`, and `room_id`. Never send keys or plaintext to the gateway.
   Omit `apns-collapse-id` or use an event-specific value. Read updates must also
   be alerts (`apns-push-type: alert`); the extension drops them.
   `event_id_only` pushes are not supported: the extension cannot fetch events.
4. Request the restricted `com.apple.developer.usernotifications.filtering`
   entitlement (rings and read updates are dropped with empty content) and enable
   Communication Notifications for both App IDs. Without filtering, the system
   shows the generic alert instead.
5. Install the Rust target matching the Xcode destination. Run `tauri ios init`
   after template changes; the extension build uses the workspace lockfile.

Sign out before switching existing private sessions to shared storage. Without
App Group access or the first unlock after reboot, the extension cannot decrypt.
Missing keys produce generic alerts; the extension does not sync to recover them.

Messages group and clear by recipient/room. Duplicate checks also match event ID;
replacements are silent. Cross-process deduplication is not atomic.

## Verification

- `cargo test -p sable-push`: payloads, account binding and privacy.
- macOS: build simulator/device targets; inspect extension, entitlements and APNs environment.
- iPhone: foreground/background/terminated/locked delivery, missing keys, timeout,
  hidden previews, logout, account switching, token rotation and duplicate alerts.

Swift compilation, signing, memory use and APNs delivery remain unverified on Linux.
