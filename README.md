# PDF Studio

Browser-based PDF editor with AI assist. Files never leave the browser; AI features send extracted text through a Cloudflare Worker to Claude.

- `npm run dev` – app on http://localhost:5173 (copy `.env.example` to `.env`)
- `npm run worker:dev` – AI proxy on http://localhost:8787 (see `worker/README.md`)
- `npm test`, `npm run worker:test`, `npm run e2e`

**Markup and forms.** Tools: highlight, note, draw, rectangle, arrow, text box and sign. Existing form fields can be filled in, with a Clear form button to reset them. Signatures can be drawn, typed or uploaded; "Remember" stores the signature only in this browser's localStorage and it is never sent anywhere. Downloads keep annotations editable in Acrobat and Preview, while signatures are flattened into the page.

Specs and plans live in `docs/superpowers/`.
