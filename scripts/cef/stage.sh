#!/usr/bin/env bash
#MISE description="Stage the CEF runtime and the desktop files for packaging"
# Usage: scripts/cef/stage.sh [stage-dir] [display-name] [profile]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STAGE="${1:-$ROOT/target/cef-stage}"
DISPLAY_NAME="${2:-Sable}"
PROFILE="${3:-release}"

if [ "${SABLE_BUILD_FLAVOR:-}" = "stable" ]; then
  MIME_SCHEMES="x-scheme-handler/sable;x-scheme-handler/moe.sable.app;"
else
  MIME_SCHEMES="x-scheme-handler/moe.sable.next;"
fi

RUNTIME="$STAGE/runtime"
SHARE="$STAGE/share"
rm -rf "$STAGE"
mkdir -p "$RUNTIME" "$SHARE/applications"

bash scripts/cef/copy-libs.sh "$PROFILE" "$RUNTIME"

cat > "$SHARE/applications/sable-next.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$DISPLAY_NAME
Comment=A Matrix client
Exec=sable-next %U
Icon=sable-next
Terminal=false
Categories=Network;InstantMessaging;Chat;
StartupWMClass=sable-next
MimeType=$MIME_SCHEMES
EOF

for size in 32x32 64x64 128x128; do
  mkdir -p "$SHARE/icons/hicolor/$size/apps"
  cp -f "src-tauri/icons/$size.png" "$SHARE/icons/hicolor/$size/apps/sable-next.png"
done
mkdir -p "$SHARE/icons/hicolor/256x256/apps"
cp -f src-tauri/icons/128x128@2x.png "$SHARE/icons/hicolor/256x256/apps/sable-next.png"

echo "staged $DISPLAY_NAME into $STAGE"
