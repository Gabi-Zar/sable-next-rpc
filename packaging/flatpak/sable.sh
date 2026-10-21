#!/bin/sh
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
export CHROME_DESKTOP="$FLATPAK_ID.desktop"
exec zypak-wrapper /app/sable-electron/sable-electron "$@"
