#!/bin/sh
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
export CHROME_DESKTOP="$FLATPAK_ID.desktop"
dir=/app/sable-electron
[ -d /app/extra/sable-electron ] && dir=/app/extra/sable-electron
exec zypak-wrapper "$dir/sable" "$@"
