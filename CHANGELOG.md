# Sable Changelog

## 2.0.3 (2026-10-17)

### Fixes

* Publish the Electron build as a Flatpak and to the deb and rpm registries.
* Fix sign-in focus, hide Next until the provider is validated, and announce authentication loading and errors.
* Add Ctrl/Cmd+E, Ctrl/Cmd+G and Ctrl/Cmd+S shortcuts to toggle the emoji, GIF and sticker pickers. Inline code moves to Ctrl/Cmd+Shift+C.
* Fix color inconsistency in timeline for senders when no custom name color is set.
* Fix Electron Linux packages and publish update manifests to Forgejo.
* Fixed profiles not being consistent between default and custom colors.
* Follow the system light or dark mode live on the Linux desktop app
* Add Default, System, and Custom font choices in Appearance. Fix theme overrides hiding font selections and monospaced font settings resetting after restart.
* Made monospace font consistent and added code ligatures to inline and block code, as well as file previews
* Ask an older tab to reload when a newer Sable opens, instead of both writing to local storage
* Option to pin PMP picker to left side of composer
* Room header actions are a keyboard toolbar, and settings pass accessibility checks
* Include custom settings panels in search and show their setting names in shared links.
* Sign-in and setup are quieter for screen readers
* Stop counting thread messages in a room's unread badge

* Add new UI sounds & ringtone

* Add a Nix flake

* Added new audio player design

* Keep usernames at top of the message in compact layout

* Pause sync while the web app is hidden

* Remove message groups from Compact layout

* Show avatars in message headers in Compact layout

## 2.0.2 (2026-10-11)

### Fixes

* Add pronoun extraction to PluralKit imports
* Add DeArrow support for YouTube embeds

## 2.0.1 (2026-10-11)

### Features

- Add a confirmed option to delete all per-message profiles.

### Fixes

- Allow fullscreen video playback on Android.
- Keep the sidebar's current room list when opening Create Room.
- Bring back the body field in the emoji and sticker pack editor.
- Fill the invite field from a suggestion instead of inviting straight away.
- Collapse the mobile alert slot when no alerts remain.
- Centre the selected mobile toolbar item on its icon.
- Stop pasting copied text from adding a newline before it.
- Stop flooding the homeserver with presence updates.
- Allow saving a status without an emoji.
- Keep the unread position when the timeline resumes after a while in the background.

## 1.22.9 (2026-09-26)

### Notes

- The last Sable v1 release. Sable v2 continues from here.
