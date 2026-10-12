import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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

// pdf.js decodes JBIG2 and JPEG 2000 with wasm modules it fetches by fixed filename from `wasmUrl` (see render.ts), so serve them unhashed at /pdfjs-wasm/.
const pdfjsWasm = (): Plugin => {
  const dir = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "wasm")
  const files = () => readdirSync(dir).filter((n) => /\.(wasm|js)$/.test(n))
  return {
    name: "pdfjs-wasm",
    generateBundle() {
      const emitted = files()
      for (const name of emitted) this.emitFile({ type: "asset", fileName: `pdfjs-wasm/${name}`, source: readFileSync(join(dir, name)) })
      console.log(`[pdfjs-wasm] emitted: ${emitted.join(", ")}`)
    },
    configureServer(server) {
      server.middlewares.use("/pdfjs-wasm/", (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next()
        const name = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, ""))
        if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || !files().includes(name)) { res.statusCode = 404; res.end("Not found"); return }
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript")
        res.end(readFileSync(join(dir, name)))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropOrtRuntime(), pdfjsWasm()],
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
})
