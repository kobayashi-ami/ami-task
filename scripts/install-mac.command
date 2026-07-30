#!/bin/bash
# One-shot macOS setup for AmiTask:
#   - creates a Spotlight-/Dock-friendly launcher app in ~/Applications
#   - gives it the bubble icon (assets/icon.png)
#   - refreshes the icon cache
# Re-run any time; it just overwrites the launcher.
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"     # repo root (one level up from scripts/)
APP="$HOME/Applications/AmiTask.app"

echo "Repo:      $DIR"
echo "Launcher:  $APP"
mkdir -p "$HOME/Applications"

# 1) The launcher app: opens Terminal and runs the app's own start script.
osacompile -o "$APP" \
  -e "tell application \"Terminal\" to do script \"cd '$DIR' && ./start.command\""

# 2) Build a proper multi-size .icns from the bubble PNG and apply it.
if [ -f "$DIR/assets/icon.png" ]; then
  WORK="$(mktemp -d)"
  ICONSET="$WORK/AmiTask.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$DIR/assets/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z "$d" "$d" "$DIR/assets/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
  touch "$APP"
  rm -rf "$WORK"
  echo "Applied the bubble icon."
else
  echo "assets/icon.png not found — skipping icon (launcher still works)."
fi

# 3) Refresh the Dock so the new icon shows immediately.
killall Dock >/dev/null 2>&1 || true

echo ""
echo "Done. Launch it with  Cmd+Space -> \"AmiTask\"  (or from ~/Applications)."
open "$HOME/Applications"
