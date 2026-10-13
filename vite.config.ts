import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { checkProdEnv } from './scripts/prodEnv.ts'
import { defineConfig, loadEnv, type Plugin } from 'vite'

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
const PDFJS_WASM_FILES = ['jbig2.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'qcms_bg.wasm', 'quickjs-eval.js', 'quickjs-eval.wasm']
const pdfjsWasm = (): Plugin => {
  const pkgPath = createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  const dir = join(dirname(pkgPath), 'wasm')
  // Versioned path so a pdfjs-dist upgrade never pairs new JS with cached old wasm (must match pdfjs.version in render.ts).
  const version: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version
  const prefix = `/pdfjs-wasm/${version}/`
  return {
    name: 'pdfjs-wasm',
    generateBundle() {
      // wrangler's SPA fallback would answer a missing file with index.html (200), i.e. a silent blank render; fail the build instead.
      const present = new Set(readdirSync(dir))
      const missing = PDFJS_WASM_FILES.filter((n) => !present.has(n))
      if (missing.length) throw new Error(`[pdfjs-wasm] missing in ${dir}: ${missing.join(', ')}`)
      for (const name of PDFJS_WASM_FILES) this.emitFile({ type: 'asset', fileName: `pdfjs-wasm/${version}/${name}`, source: readFileSync(join(dir, name)) })
      console.log(`[pdfjs-wasm] emitted to pdfjs-wasm/${version}/: ${PDFJS_WASM_FILES.join(', ')}`)
    },
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''))
        if (!PDFJS_WASM_FILES.includes(name)) { res.statusCode = 404; res.end('Not found'); return }
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(readFileSync(join(dir, name)))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    const bad = checkProdEnv(loadEnv(mode, process.cwd(), 'VITE_'))
    if (bad.length) throw new Error(`[prod-env] missing or dev-only value for ${bad.join(', ')} (see .env.production)`)
  }
  return {
    plugins: [react(), dropOrtRuntime(), pdfjsWasm()],
    optimizeDeps: { exclude: ["@huggingface/transformers"] },
    worker: { format: "es" },
  }
})
