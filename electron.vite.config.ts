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
    plugins: [react(), tailwindcss()]
  }
})
