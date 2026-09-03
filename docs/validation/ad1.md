# ad1 — Documents (§31): what was measured, on the machine

Spike for PRD §31, run 2026-09-03/04 on this Mac (darwin arm64, Node v22.21.1; the bundled
Electron helper reports v24.18.1). Throwaway code lived in the session scratchpad; what survives is
this file, the pin, and `tests/fixtures/documents/`.

**Headline: the pin is `@firecrawl/anydoc` 0.2.4, and the reason is the opposite of what the
proposal predicted.** 0.2.3 does not "yield the text pages" of a mixed PDF — it rejects the whole
file as `unsupported` with no page numbers. 0.2.4 also rejects the whole file, but as `needsOcr`
carrying `pages` and `pageCount`. What the newer pin buys is **the page list that makes the sentence
honest**, not partial text. Neither version returns the text pages of a mixed PDF.

## 1. The pin: 0.2.3 vs 0.2.4 on the same fixtures

Same corpus, same machine, `toMarkdown(path)` on the native binding.

| fixture | 0.2.3 | 0.2.4 |
|---|---|---|
| `mixed.pdf` (1 text page + 1 image page) | `unsupported` — *"PDF has no extractable text (ImageBased, 2 pages)"*, **no `pages` field** | `needsOcr` — `pages:[2]`, `pageCount:2`, *"page 2 of 2 needs OCR"* |
| `scanned.pdf` (all pages images) | `unsupported` — *"(Scanned, 2 pages)"*, no fields | `needsOcr` — `pages:[1,2]`, `pageCount:2`, *"all 2 pages need OCR"* |
| `encrypted.odt` | `encrypted` | `encrypted` |
| every other fixture | identical output, byte for byte | identical |

**Decision: 0.2.4.** `documentErrorSentence` names the scanned pages (PRD §31 decision C/H), and on
0.2.3 there is nothing to name — the error is an undifferentiated `unsupported`, the same code an
unrecognised file gets. Upstream #144/#162 (one image page rejecting the whole PDF) **is present in
0.2.4 and was already present in 0.2.3**; the issue is a real limitation for both, and the fixture
in `tests/anydoc-contract.test.ts` is what tells us the day it is fixed.

## 2. Conversion, all 13 extensions plus the two refusals (0.2.4)

`ms` is the conversion alone, in-process, warm.

| fixture | ms | lines | bytes of Markdown |
|---|---|---|---|
| sample.doc | 0.9 | 76 | 1 250 |
| sample.docx | 0.7 | 78 | 1 316 |
| sample.odt | 0.6 | 77 | 1 322 |
| sample.rtf | 0.7 | 77 | 1 321 |
| sample.epub | 0.4 | 41 | 757 |
| sample.xls | 0.3 | 19 | 396 |
| sample.xlsx | 0.4 | 19 | 396 |
| sample.xlsb | 0.2 | 7 | 369 |
| sample.ods | 0.4 | 19 | 396 |
| sample.ppt | 0.1 | 4 | 54 |
| sample.pptx | 0.6 | 22 | 273 |
| sample.odp | 0.9 | 21 | 272 |
| text.pdf | 6.3 | 42 | 1 096 |
| `table.csv` | 0.2 | 10 | 294 — **converts fine; the exclusion is ours** (decision K) |
| `notes.txt` | 0.2 | — | `unsupported` (*"unrecognized file content and extension"*) |

Upstream's 4.4–4.7 ms median is consistent with this: everything but PDF is sub-millisecond here.

**`formatFromExtension` accepts all 13 we expose**, mapping container variants onto the parser
family exactly as the API docs claim: `docm→docx` · `pps/pot→ppt` · `pptm/ppsx/ppsm→pptx` ·
`xls/xlsm/xlsb→xlsx`. `txt` and `md` return `null`. `formatFromPath` returns a **plain lower-case
string** (`"docx"`, `"pdf"`; `y.xls → "xlsx"`), which is what the facts line's family lookup takes.

**Error codes observed**, all on `error.code`, matching the declared `ConvertErrorCode` union:
`encrypted` · `needsOcr` (with `pages`/`pageCount`) · `unsupported` · `io`. A **missing file and a
directory both give `io`**.

## 3. Two findings that changed the design

### 3.1 There is no page count on a successful conversion — anywhere

`toMarkdown(path)` returns `Promise<string>`. No metadata object, no page count. `toDocument` is
**explicitly unsupported for PDF** (`index.d.ts`: *"PDF conversion produces Markdown directly and
has no document-model form"*), and for the other formats it returns blocks, not pagination —
pagination is a layout property those formats do not carry.

`pageCount` exists on exactly one surface: the `NeedsOcrError` rejection.

**Consequence:** the chip and the facts line cannot show `12 pages`. The proposal's
`report.docx · Word · 12 pages · 88 KB as Markdown` is not obtainable. The `pages` field is
therefore carried **only on the error path**, where it is load-bearing (the sentence names the
scanned pages), and dropped from the success path, the block header and the chip rather than
invented. This is §9's "labelled, never guessed" rule applied one section over.

### 3.2 The package's own entry point contains the network path; the native binding does not

`package.json` `main` is **`anydoc.js`**, a JS wrapper whose source begins:

```js
const API_URL = 'https://api.firecrawl.dev'
const TIMEOUT_MS = 300_000
```

That wrapper implements `options.ocr === 'hosted'` by uploading the document to Firecrawl Parse.
`index.js` beside it is the napi-rs binding loader and exports the same full surface
(`toMarkdown`, `toMarkdownBytes`, `toDocument`, `formatFrom*`) with **no network code at all** —
`anydoc.js` itself is a thin wrapper over `require('./index.js')`.

**Consequence:** the sidecar imports `index.js` by explicit relative path, never the bare package
name. §31's privacy claim is therefore stronger than "we never pass the `ocr` option": the code that
could send a document off the machine is **never loaded into the process**. There is no exports map
in the package, so the deep import is legal; the contract test pins it, because a pin that renames
that file is a pin that silently re-introduces the wrapper.

## 4. The sidecar: spawn cost and the memory case for it

| measurement | plain Node v22 | bundled Electron helper (`ELECTRON_RUN_AS_NODE=1`) |
|---|---|---|
| spawn + import + convert `sample.docx`, median of 10 | **24 ms** | **60 ms** |
| the addon loads and converts every fixture | yes | yes, byte-identical, `needsOcr` fields included |

Both are far under the ~150 ms the proposal accepted. The helper path is the one the packaged app
takes (`nodeExecPath()`), and it works.

**Why the sidecar exists, measured.** A synthetic 200 000-row workbook (2.3 MB zipped, 21.6 MB of
sheet XML) converts in **781 ms** and produces **4.1 MB of Markdown**, and the converting process's
RSS peaks at **848 MB**. The parent that spawned it went 40.1 MB → 37.8 MB, i.e. flat.

That 848 MB is upstream #155 in a number. In-process in Electron main it would be permanent
high-water for the session; in a child it is reclaimed at exit. This is the whole justification for
decision A, and it is no longer an argument from an issue tracker.

The same workbook also shows why the caps in decision E are not theoretical: 4.1 MB of Markdown is
4× `MAX_FILE_BYTES` and 20× `MENTION_CONTEXT_CAP`.

## 5. Platform

Only the matching platform package installs: `npm i` on this Mac pulled `@firecrawl/anydoc` plus
`@firecrawl/anydoc-darwin-arm64` and nothing else. The other six prebuilts are `optionalDependencies`
(darwin-x64, linux-x64/arm64 × gnu/musl, win32-x64-msvc); **there is no win32-arm64**.

The app builds macOS only today (`electron-builder.yml` targets `dmg`; CI is `macos-latest`), so
the gap is not reachable. `@firecrawl/anydoc-wasm` is the recorded path for the day it is; see the
appendix for whether it loads.

## 6. Fixtures

`tests/fixtures/documents/` — 284 KB, 18 files, copied from the `firecrawl/anydoc` upstream test
corpus (MIT, shallow clone 2026-09-03) except `notes.txt`, written here. Per-file provenance is in
that directory's own `README.md`. Every one of §31's seven families is represented, plus the legacy
`.doc`/`.xls`/`.ppt` binaries the risk list calls the least-tested corner, plus `table.csv` and
`notes.txt` whose job is to prove they are **refused**.

## Appendix: WASM is not a drop-in fallback

`@firecrawl/anydoc-wasm@0.2.4` **imports** cleanly under Node, but is not swappable for the native
addon, and the difference is structural rather than a version quirk:

- **It has no `toMarkdown`.** Exports are `formatFromBytes`, `formatFromExtension`, `formatFromPath`,
  `toDocument`, `toMarkdownBytes`, `initSync`. WASM has no filesystem, so the path-taking entry
  point does not exist — a caller must read the file itself and pass bytes.
- **It needs an explicit init.** Calling `toMarkdownBytes` straight after import throws
  `Cannot read properties of undefined (reading '__wbindgen_add_to_stack_pointer')`; the
  `initSync` export has to be given the `.wasm` binary first (the wasm-bindgen convention).

So the Windows-arm64 path is a **real second code path in the sidecar** — init, read, convert from
bytes, and no `toMarkdown` — not a changed import line. Cheap enough to write when a Windows build
exists, and worth knowing now that it is not free. Nothing here is wired into the app.

## GUI pass (2026-09-04, dev build, driven over CDP)

Every claim below was observed in the running app, not inferred from a test.

**Composer.** The `+` menu's row reads **Attach document** with the subtext
*Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB*. The two absences the design is
about are visible absences: **no `CSV`**, and **no "coming soon"** row.

**Conversion inside the real app**, through `nodeExecPath()` rather than plain node:
`documentsAvailable()` → true; `sample.docx` → `{format:"docx", lines:78, bytes:1316}`;
`mixed.pdf` → the scanned-pages sentence; `table.csv` → *Not a document — use `read`…*;
`encrypted.odt` → *Encrypted — … password-protected*.

**Settings.** *Documents — 1 tool* sits under *Agent browser — 10 tools*, above *Tool intent*,
with the shared respawn note and the local-conversion claim. There is no *Agent documents* row.

**Agent tools page** (the surface where the switch is observed): `document_read` listed with
**ALLOW**, which is `SAFE_TOOLS` doing its job.

**The regression sequence, performed:** switch Documents off → the Agent tools page no longer
lists `document_read` while `browser_get_text` remains → the composer's *Attach document* row is
**disabled and says "off in Built-in tools"**.

**End to end, with the agent:** a message carrying `sample.docx` produced a
`<document path="…" format="docx">` block in the session file, and the model answered
**"Fixture Document"** — the file's actual H1. The bubble shows a **`sample.docx · Word`** chip,
the typed question, and **neither the markup nor the Markdown**. Reopening the session shows the
same three things, rebuilt from the block header.

**Plan mode:** `document_read` ran with **no permission modal**, carrying its required intent
(*"Reading the RTF sample to find its first heading."*) and returning
`sample.rtf — RTF · 77 lines · 1 KB · showing 1–77`.

### Four bugs the GUI pass caught that the suite did not

1. **preload dropped the `documents` argument.** It invoked `hv:prompt-session` with six
   arguments while `hv.d.ts`, main and App all declared seven. Nothing failed — the block simply
   never injected and the agent never saw the document. Typechecks cleanly, because the two sides
   are separate tsconfig roots kept in sync by hand.
2. **The live bubble showed no chip.** App appends the bubble from the text the user TYPED, while
   the blocks are assembled main-side, so only a reopened session had anything to parse. The chips
   now ride the transcript item live and fall back to the header on restore.
3. **The `+` row went stale.** ChatView read the toggle once on mount and stays mounted while the
   user visits Settings, so after switching Documents off the row stayed enabled — offering a tool
   that was already unregistered. It now reads the value when the menu opens.
4. **"page 2 is scanned images."** The verb agreed with the page count and the noun did not.

Each is now pinned by a test.
