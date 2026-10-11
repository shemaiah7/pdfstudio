import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The ONNX runtime wasm/mjs exceed Cloudflare's 25 MiB asset cap; production loads them from the CDN (see embedWorker.ts).
const dropOrtRuntime = (): Plugin => ({
  name: 'drop-ort-runtime',
  apply: 'build',
  generateBundle(_, bundle) {
    const dropped: string[] = []
    for (const name of Object.keys(bundle)) {
      if (bundle[name].type === 'asset' && /ort-wasm.*\.(wasm|mjs)$/.test(name)) { delete bundle[name]; dropped.push(name) }
    }
    if (dropped.length) console.log(`[drop-ort-runtime] dropped: ${dropped.join(', ')}`)
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropOrtRuntime()],
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
})
