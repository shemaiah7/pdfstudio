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
3. `wrangler.jsonc` `vars` hold the production `ALLOWED_ORIGIN` and `TURNSTILE_HOSTNAMES`; `.dev.vars` overrides them for local dev (the dev list includes `example.com`, the hostname Turnstile's test keys report).
4. `npm run deploy`.

## Owner key
Gives the site owner unlimited AI, Deep OCR and voice minutes (Turnstile still applies).
1. Generate a key: `openssl rand -base64 48` (must be at least 32 characters, otherwise owner mode stays off).
2. Set it as a secret from `worker/`: `npx wrangler secret put OWNER_KEY`.
3. Unlock a browser by opening `https://<site>/#owner=<key>` once; the app stores the key and removes it from the address bar.
4. Clear a browser with `https://<site>/#owner=`.

## Protocol
POST /session { turnstileToken, ownerKey? } → { token, expiresAt, owner? }
POST /ai (Bearer token) { task, document, ... } → SSE: delta / done / error
