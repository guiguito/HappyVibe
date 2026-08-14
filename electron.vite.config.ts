import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
