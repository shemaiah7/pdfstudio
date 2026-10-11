# PDF Studio

Browser-based PDF editor with AI assist. Files never leave the browser; AI features send extracted text through a Cloudflare Worker to Claude.

- `npm run dev` – app on http://localhost:5173 (copy `.env.example` to `.env`)
- `npm run worker:dev` – AI proxy on http://localhost:8787 (see `worker/README.md`)
- `npm test`, `npm run worker:test`, `npm run e2e`

Specs and plans live in `docs/superpowers/`.
