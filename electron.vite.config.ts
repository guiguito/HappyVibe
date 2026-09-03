import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// §30: ONE version, and it lives in package.json. The renderer receives it as a
// build-time constant rather than an app.getVersion() IPC round trip, because it
// IS a build-time fact and the honest representation of one is a constant.
//
// The pins come from the vendored runtime's own manifest for the same reason —
// §3's promise is that the Pi inside is pinned and tested, so the line the
// Changelog page shows has to be the line that was actually built in, not one
// someone typed and forgot to update at the next bump.
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, rel), 'utf8'))
const pkg = readJson('package.json') as { version: string }
const pins = (readJson('pi-runtime/package.json') as { dependencies: Record<string, string> })
  .dependencies
const runtimePins =
  `Pi ${pins['@earendil-works/pi-coding-agent']}` +
  ` · sub-agents ${pins['pi-subagents']}` +
  ` · MCP adapter ${pins['pi-mcp-adapter']}` +
  // §31: the document converter decides what the model reads of a PDF, which
  // makes it an engine — §3's promise is that which engine you got is user-facing.
  ` · anydoc ${pins['@firecrawl/anydoc']}`

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // §27: the voice inference worker is a SECOND entry, emitted beside the
        // main bundle as out/main/voice-worker.js — the path host.ts forks.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'voice-worker': resolve(__dirname, 'src/main/voice/worker.ts')
        },
        // sherpa-onnx-node is a NATIVE module: it must resolve from
        // node_modules at runtime, never be inlined into the bundle.
        external: ['sherpa-onnx-node']
      }
    }
  },
  preload: {},
  renderer: {
    // §30: injected here rather than imported, so no package.json (with its whole
    // dependency list) ends up inlined in the renderer bundle.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __RUNTIME_PINS__: JSON.stringify(runtimePins)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      // §27: the audio worklet MUST stay a real emitted file. Vite inlines
      // assets under 4 kB as `data:` URLs, and the renderer's CSP is
      // `script-src 'self'`, which covers neither `data:` nor `blob:` — so an
      // inlined worklet is blocked by addModule() exactly like a blob one, but
      // ONLY in the built app, because dev serves it as a real file URL. That
      // is the "works in dev, broken in release" shape, so it is pinned by
      // tests/voice-worklet-csp.test.ts against the built bundle.
      //
      // Round 12: FONTS are the same trap, and one was already caught by it.
      // The CSP sets no `font-src`, so fonts fall back to `default-src 'self'`,
      // which does not cover `data:` — an inlined font is refused outright:
      //
      //   Refused to load the font 'data:font/woff2;base64,…' because it
      //   violates the following Content Security Policy directive:
      //   "default-src 'self'".
      //
      // Only ONE subset was small enough to trigger it (jetbrains-mono
      // cyrillic-ext, 2,028 B); every other subset is ≥7.5 kB and was emitted
      // as a file, which is exactly why this looked fine. Excluding fonts by
      // EXTENSION rather than by that one filename is the same size of change
      // and cannot regress when the next small subset appears.
      //
      // The alternative — widening the CSP with `font-src 'self' data:` — is
      // refused on the §27 rule: the CSP is not loosened to make an asset load.
      //
      // `false` = never inline; `undefined` = Vite's normal behaviour.
      assetsInlineLimit: (filePath: string) =>
        filePath.includes('voice-worklet') || /\.(woff2?|ttf|otf|eot)$/i.test(filePath)
          ? false
          : undefined
    },
    plugins: [react(), tailwindcss()]
  }
})
