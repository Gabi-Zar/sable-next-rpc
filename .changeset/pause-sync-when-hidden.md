---
default: patch
---

# Pause sync while the web app is hidden

Sync now idles once every tab is hidden and restarts when a tab is visible again or the network returns, so a computer that slept no longer leaves sync on a dead connection.
