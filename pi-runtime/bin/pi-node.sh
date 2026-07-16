#!/bin/sh
# HappyVibe: launches the embedded Pi CLI without requiring a system Node.
# pi-subagents spawns PI_SUBAGENT_PI_BINARY directly as the command, so it must
# be a real executable. The packaged app ships no `node`, but Electron's helper
# binaries ARE Node when ELECTRON_RUN_AS_NODE=1 — route through the bundled
# "<name> Helper (Plugin).app" (LSUIElement=1, no Dock icon; same reasoning as
# nodeExecPath() in src/main/pi/spawn.ts). In dev there is no bundle around
# pi-runtime, so fall back to `node` on PATH.
RUNTIME="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"

# Packaged layout: <Bundle>/Contents/Resources/pi-runtime → helpers live in
# <Bundle>/Contents/Frameworks/. Discover relative to this script.
CONTENTS="$(dirname "$(dirname "$RUNTIME")")"
for h in "$CONTENTS/Frameworks/"*" Helper (Plugin).app/Contents/MacOS/"*; do
  if [ -x "$h" ]; then
    export ELECTRON_RUN_AS_NODE=1
    exec "$h" "$CLI" "$@"
  fi
done

exec node "$CLI" "$@"
