# pdfstudio-ai Worker

Proxy between the PDF Studio app and the Claude API.

## Local dev
1. `cp .dev.vars.example .dev.vars` and set a real `ANTHROPIC_API_KEY`, a random `SESSION_SECRET`, and the Turnstile test secret.
2. `npm run dev` (from this folder) or `npm run worker:dev` (from the repo root). Listens on http://localhost:8797 (set in `wrangler.jsonc` `dev.port`; change it if that port is taken). `ALLOWED_ORIGIN` accepts a comma-separated list; dev allows Vite ports 5173-5175. Restart `wrangler dev` after editing `.dev.vars`.

## Tests
`npm test` runs in the local Workers runtime. `ANTHROPIC_API_KEY=... npm test` also runs the live integration test.

## Deploy (first time)
1. `npx wrangler kv namespace create QUOTA` and paste the id into `wrangler.jsonc`.
2. `npx wrangler secret put ANTHROPIC_API_KEY`, `TURNSTILE_SECRET`, `SESSION_SECRET`.
3. Set `ALLOWED_ORIGIN` and `TURNSTILE_HOSTNAMES` in `wrangler.jsonc` to the app's production origin/hostname. (In dev the list includes `example.com`, which is the hostname Turnstile's test keys report.)
4. `npm run deploy`.

## Protocol
POST /session { turnstileToken } → { token, expiresAt }
POST /ai (Bearer token) { task, document, ... } → SSE: delta / done / error
