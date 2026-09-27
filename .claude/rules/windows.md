---
paths:
  - "src/main/platform.ts"
  - "pi-runtime/extensions/hv-paths.ts"
  - "src/renderer/src/{basename,platformCopy,shortcuts}.ts"
  - "scripts/test.mjs"
  - "build/{win-build,afterPack,afterPackLayout}.mjs"
  - "electron-builder.yml"
  - "tests/{platform,windows-skips,mod-key-copy}.test.ts"
---
# Windows (PRD §4)

- `src/main/platform.ts` answers `nodeExecPath`, `killTree`, `readCommand`, `terminalShell`,
  `terminalShellArgs`, `agentShell`, `workspaceKey` and `detectedShells` from INJECTED deps, so a
  Windows platform is constructed and asserted on macOS CI (`tests/platform.test.ts`).
- Sub-agents need no launcher: tintinweb builds children inside the session's own Pi process.
- **Kill the TREE.** `child.kill()` is TerminateProcess — no handler runs, so every bash command and
  stdio MCP server outlives the session. Use `taskkill /T /F` with NO grace period (Pi appends its
  session file with `appendFileSync`, and its own SIGTERM path skips the stdout flush anyway).
- Paths fold separators and case on win32 via `hv-paths.ts` (permission rules, the outside-workspace
  ask, write confinement) — otherwise a `src/**` rule matches nothing and `D:\other` reads as inside
  the workspace. In the renderer `basename()` splits on both separators; the things that only LOOK
  like paths (a URL host, a `provider/modelId`) stay forward-slash.
- `npm test` is `node scripts/test.mjs` (inline `VAR=… vitest` is POSIX-only).
  `tests/windows-skips.test.ts` pins each platform/capability gate with a reason. Prefer a CAPABILITY
  probe (`CAN_SYMLINK`, `CAN_DENY_READ`) over a platform skip — a box with Developer Mode on still
  runs the symlink tests.
- Installer: NSIS x64 only (no win-arm64 build of sherpa or anydoc exists), per-user, user data kept.
  `afterPack` drops `dist-types` and FAILS the build if the worst-case install path exceeds MAX_PATH —
  it sits a few characters under the limit, so the next deep dependency trips it. Signing is
  `HV_WIN_SIGN=azure` plus four `AZURE_SIGN_*` secrets; a half-configured request throws.
- Terminal specifics (`pty.process`, `inSocket`): `terminals.md`. Measurements:
  `docs/validation/win1.md`.
