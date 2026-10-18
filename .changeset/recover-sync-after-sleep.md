---
default: patch
---

# Recover web sync after the computer sleeps

A sync request left on a dead connection after the computer slept now gives up after a minute and reconnects, and sync also retries as soon as a tab is visible again or the network returns. Background tabs keep syncing, so notifications and the unread favicon keep updating.
