# vo1 — Voice input (§27): what was measured, on the machine

Measured 2026-08-07 on the dev build (Apple Silicon, macOS 26.5.2, Electron 43.1.1),
against the real downloaded model. Everything here is a reading, not a citation of
the proposal — where the two disagree, that is called out.

## Model acquisition

The manifest is exact. The download completed at **670,478,772 bytes**, matching
`VOICE_MODEL.totalBytes` to the byte, and all four SHA-256 digests verified —
`downloadFile` throws on mismatch and deletes both the `.part` and the target, so
reaching `state: "ready"` *is* the proof that four digests matched.

| File | Bytes on disk | Pinned |
|---|---:|---|
| `encoder.int8.onnx` | 652,184,281 | ✔ |
| `decoder.int8.onnx` | 11,845,275 | ✔ |
| `joiner.int8.onnx` | 6,355,277 | ✔ |
| `tokens.txt` | 93,939 | ✔ |

Digest provenance: the three ONNX files are LFS objects, so their Hugging Face
`oid` **is** the sha256 and no download was needed to pin them. `tokens.txt` is
not an LFS object — its digest was computed locally. Re-derive the same way on a
pin bump.

**Progress plumbing.** `hv:voice-status-changed` delivered **12 snapshots in 3 s**
— the intended ~4 Hz throttle, not the thousands of `data` events the 652 MB body
actually fires — and `bytesDone` was monotonic across them (197 MB → 348 MB in
that window). The state machine went `unactivated → downloading → ready` with no
intermediate bad state.

## Transcription

Against the pinned fixture (`test_wavs/en.wav`, 24 kHz, resampled by sherpa):

> `"Ask not what your country can do for you, ask what you can do for your country."`

Correctly punctuated and capitalised, as the proposal claimed. **Silence returns
`""`** — three seconds of digital zeros produced no phantom text, so the TDT
transducer does not exhibit Whisper's hallucination-on-silence behaviour here.
That is one measurement, not a guarantee; the energy gate is still what makes the
question moot in practice, because the model is never invoked on silence.

## The utilityProcess

Through the app's real path (renderer → `hv:voice-transcribe` → main → utility child):

| | Latency |
|---|---:|
| Cold (includes model load) | **1364 ms** |
| Warm (same process, model resident) | **48 ms** |

The warm figure is the one users feel, and it confirms the child survives between
calls. The cold figure is consistent with the proposal's ~930 ms load claim.

**Dock icon: not an issue, and now known structurally rather than hoped.** The
child reports `--type=utility --utility-sub-type=node.mojom.NodeService` — a
Chromium service, not a raw `spawn` of the Electron binary — so the documented
"generic exec icon" class (which `nodeExecPath()` exists to solve for Pi children)
does not apply. No `nodeExecPath()` equivalent is needed here.

## Resident memory — the §14.3 ship gate is NOT closed

Measured RSS of the voice child after two 1-second clips: **0.83 GB**, against the
proposal's stated **1.83 GB peak**.

These are not contradictory and the lower number must not be treated as good news
yet: the proposal's figure is *peak* on an 11.54-second utterance, and a
FastConformer encoder's activations scale with sequence length, so a longer clip
will read higher. What this does establish is a **floor of ~0.83 GB** for the
resident model.

Still owed before shipping, unchanged: the measurement on an **8 GB machine with a
Pi session live**, per PRD §27 / §14.3.

## Verified on screen

Against the running dev build, in the GUI:

- The composer chip carries **no HTML `disabled` attribute** in its unactivated
  state (`hasDisabledAttr: false`) — the activation flow depends on that first
  click landing, and a disabled button would swallow it.
- The activation modal reads "671 MB", states the privacy promise, and **names no
  model**. A scan of the entire chat surface — body text *and* `title`/`aria-label`
  attributes — for `parakeet`, `nvidia`, `sherpa`, `fastconformer`, `tdt` returned
  **zero hits**. The same scan on the Voice page's expanded licenses block returns
  all of them, which is the point: attribution exists in exactly one place.
- The language `<select>` holds **exactly 25 options with zero `disabled` ones**,
  12 annotated *lower accuracy*. Japanese, Korean, Chinese, Arabic, Hindi and Thai
  are **absent**, not greyed out.
- The Shortcuts page shows *Dictate into the composer* as **BUILT-IN** with no
  button or input in its row, and the Editable list holds 9 actions, none of them
  dictation. A rebindable entry there could never fire — `eventToBinding` returns
  null for a modifier-only binding.
- **Cross-surface:** starting the download from the *Voice page* flipped the *chat
  tab's* chip from "Set up voice input" to "Dictate" with no reload.
- **Regression, right ⌘ + S:** dispatched against the focused composer, the chip
  never left "Dictate" — the abandon rule holds through the real wiring, not just
  the reducer's unit test.
- **Regression, Escape ordering (half):** with the `@`-mention dropdown open and
  nothing recording, Escape closed the dropdown. Dictation-cancel does not steal
  Escape when idle, which is what lets it sit last in the chain.
- Zero console errors throughout.

## The bug the GUI pass found, and the worse one hiding behind it

Reported as `Voice input: Could not start recording.` — dictation failed on every
attempt. Two defects, and the second is the one worth remembering.

**1. The audio worklet cannot be a `blob:` URL.** The first implementation
inlined the processor as a blob for bundling convenience. The renderer's CSP is
`script-src 'self'`, and `'self'` does not cover `blob:`, so `addModule()` was
blocked outright:

```
Loading the script 'blob:http://localhost:5173/…' violates the following Content
Security Policy directive: "script-src 'self'". Note that 'script-src-elem' was
not explicitly set, so 'script-src' is used as a fallback. The action has been
blocked.
```

The spec already contained the answer — §7.3 cites this same CSP as the reason
the model download runs in main rather than the renderer — the reasoning simply
was not carried across to the worklet. Fixed by making it a real file
(`voice-worklet.js`) loaded through Vite's `?url`.

**2. `?url` alone would still have shipped broken, and only when packaged.**
Vite inlines assets under 4 kB as `data:` URLs, and the worklet is 2,171 bytes.
So the "fixed" build produced:

```js
const workletUrl = "data:text/javascript;base64,LyoqCiAqIMKnMjcvwq…"
```

`script-src 'self'` covers `data:` no better than `blob:`. In **dev** Vite serves
a real file URL and everything works; in the **built app** it is an inlined data
URL and dictation dies. Works-in-dev-breaks-in-release, caught only by reading
the emitted bundle rather than trusting the source change.

The fix is a targeted `assetsInlineLimit` predicate in `electron.vite.config.ts`
returning `false` for `voice-worklet` and `undefined` for everything else. The
built bundle now reads:

```js
const workletUrl = "" + new URL("voice-worklet-CDKraGXU.js", import.meta.url).href
```

— an emitted sibling asset, same-origin, referenced relatively so it also
resolves under `file://` in the packaged app.

**Never widen the CSP to `blob:`/`data:` to make a worklet load.** That trades
the renderer's only-bundled-code-executes guarantee for a bundling convenience.
`tests/voice-worklet-csp.test.ts` pins all of it: the CSP is unchanged, the
worklet is a real file, no voice module calls `createObjectURL`, the config
exclusion exists, and — the assertion that would actually have caught defect 2 —
the **built** bundle references the worklet as a file rather than a data URL.
`npm run gate` builds before it tests, so that last one runs against fresh output.

**3. A generic error message turned a one-line bug into a mystery.** The handler
collapsed every non-`CaptureError` to `"Could not start recording."`, discarding
`"Unable to load a worklet's module."` — the string that names the problem. It
now always surfaces the underlying message and logs the object. The lesson is
cheap and general: a fallback string is for when there is genuinely nothing to
say, not instead of what the error said.

### Verified after the fix, live

`startCapture()` through the app's own module: **no throw**, **53 level updates in
1.5 s** (≈35 Hz, the intended ~30 Hz meter), and a quiet room measured
`maxLevel 0.0025` against the 0.005 floor — so the energy gate returned **0
samples and called nothing**. That is the gate working, not failing: silence
never reaches the model.

## Not verified, and why

**Anything requiring actual speech.** Permission is now granted and capture is
proven (above), but nothing has spoken into the microphone, so these are still
open:

- a transcript of real speech appending to the composer, blank-line separated;
- the level meter visibly tracking a voice rather than room tone — the numbers say
  it updates at 35 Hz, but "moves when you speak" is a human observation;
- the **full** Escape sequence (dropdown open *and* recording live: first Escape
  closes the dropdown, second cancels the recording);
- the tap-to-latch / second-tap-to-stop gesture end to end;
- the 5-minute cap.

Each is unit-tested at the reducer and gate level, and the two ends — capture and
transcription — are separately proven. What is untested is a human voice traversing
the whole chain in one go.

**Packaging.** The three signing changes (§8.2 + §8.4) are in the tree but no
packaged build was produced, so the load-bearing assertion is unrun:

```bash
npm run build && npx electron-builder --mac --dir
codesign -d --entitlements - "release/mac-arm64/HappyVibe.app/Contents/MacOS/HappyVibe"
codesign -d --entitlements - "release/mac-arm64/HappyVibe.app/Contents/Frameworks/HappyVibe Helper.app"
```

Both must list `com.apple.security.device.audio-input`. **Check the Helper** — it
is the one an otherwise-correct app-level configuration hides, and it is the whole
reason `afterPack.mjs` now passes `--entitlements`.
