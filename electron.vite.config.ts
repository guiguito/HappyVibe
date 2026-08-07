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
      // `false` = never inline; `undefined` = Vite's normal behaviour.
      assetsInlineLimit: (filePath: string) =>
        filePath.includes('voice-worklet') ? false : undefined
    },
    plugins: [react(), tailwindcss()]
  }
})
