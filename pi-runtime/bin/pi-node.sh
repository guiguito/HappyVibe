#!/bin/sh
# HappyVibe: launches the embedded Pi CLI without requiring a system Node.
# pi-subagents spawns PI_SUBAGENT_PI_BINARY directly as the command, so it must
# be a real executable. The packaged app ships no `node`, but Electron's helper
# binaries ARE Node when ELECTRON_RUN_AS_NODE=1 — route through the bundled
# "<name> Helper (Plugin).app" (LSUIElement=1, no Dock icon; same reasoning as
# nodeExecPath() in src/main/pi/spawn.ts). In dev there is no bundle around
# pi-runtime, so fall back to `node` on PATH.
RUNTIME="$(cd "$(dirname "$0")/.." && pwd)"
# dist/bundle/cli.js is upstream's own bin.pi since Pi 0.84.3; the modular
# dist/cli.js is broken from 0.85.0 (undeclared @earendil-works/pi-server).
# Keep in step with PI_CLI_RELPATH in src/main/pi/spawn.ts.
CLI="$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"

# PRD §12: every sub-agent child loads HappyVibe's permission guard. This script
# IS PI_SUBAGENT_PI_BINARY, so it is children-only — the parent session spawns
# through nodeExecPath() and never comes here.
#
# Injected HERE rather than through an agent's `extensions:` key for two reasons:
# it reaches every child with no per-agent stamping, and a capability ceiling's
# `denyExtensions` cannot strip it, because pi-args has already finished building
# argv by the time this runs (getPiSpawnCommand passes args through untouched).
#
# PREPENDED, never appended: pi-args puts the task LAST as a positional
# (`Task: …` or `@/tmp/…/task.md`), and whether a flag after a positional is
# still parsed is not something worth betting the permission gate on.
GUARD="$RUNTIME/extensions/hv-child-guard.ts"

# Packaged layout: <Bundle>/Contents/Resources/pi-runtime → helpers live in
# <Bundle>/Contents/Frameworks/. Discover relative to this script.
CONTENTS="$(dirname "$(dirname "$RUNTIME")")"
for h in "$CONTENTS/Frameworks/"*" Helper (Plugin).app/Contents/MacOS/"*; do
  if [ -x "$h" ]; then
    export ELECTRON_RUN_AS_NODE=1
    exec "$h" "$CLI" --extension "$GUARD" "$@"
  fi
done

exec node "$CLI" --extension "$GUARD" "$@"
