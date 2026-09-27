---
paths:
  - "src/main/voice/**"
  - "src/renderer/src/voice/**"
  - "src/renderer/src/components/{MicButton,Voice*}.tsx"
  - "src/renderer/index.html"
  - "electron.vite.config.ts"
  - "src/main/documents.ts"
  - "pi-runtime/bin/anydoc-bridge.mjs"
  - "pi-runtime/extensions/hv-document.ts"
  - "tests/{voice,anydoc,document}*.test.ts"
---
# Voice worklet (§27) and documents (§31)

## The CSP and the voice worklet
- The renderer CSP is `script-src 'self'`, which covers neither `blob:` nor `data:`, so an
  AudioWorklet/Worker script must be a REAL emitted file. The worklet loads via Vite `?url`, and
  `electron.vite.config.ts` excludes `voice-worklet` from `assetsInlineLimit` — otherwise a file
  under 4 kB is inlined as a `data:` URL, blocked ONLY in the built app.
- The built bundle must read `new URL("voice-worklet-<hash>.js", import.meta.url)`.
  `tests/voice-worklet-csp.test.ts` checks the CSP, the file, the config and the BUILT output.
- Never widen the CSP to `blob:`/`data:` to make a script load.
- Surface the underlying `err.message` in capture errors — a generic "Could not start recording." hid
  the real cause.

## Documents — `@firecrawl/anydoc`
- Runs in exactly one place: `pi-runtime/bin/anydoc-bridge.mjs`, a one-shot sidecar off
  `nodeExecPath()` — never in main or the Pi child (a large workbook takes the converting process to
  ~850 MB RSS).
- The sidecar imports the NATIVE BINDING (`index.js`), NOT the package's `main` (`anydoc.js`, which
  carries the hosted-OCR path to `api.firecrawl.dev`). That is §31's privacy claim;
  `tests/anydoc-contract.test.ts` asserts both halves. A bump that renames the binding file silently
  restores the wrapper.
- No page count exists on a successful conversion — omit it, never invent one. `pageCount` rides the
  `needsOcr` error only; on a mixed PDF anydoc rejects the file as `needsOcr` with the scanned pages
  listed (what the 0.2.4 pin buys).
- CSV is deliberately NOT a document (a text file; `read` handles it); the contract test keeps proving
  anydoc would convert it. The extension set is derived from `DOCUMENT_FAMILIES` — never hand-list.
  `docs/validation/ad1.md`.
