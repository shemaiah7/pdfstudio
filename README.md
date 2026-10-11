# PDF Studio

Browser-based PDF editor with AI assist. Files never leave the browser except page images you explicitly send with Deep OCR; AI features send extracted text through a Cloudflare Worker to Claude.

- `npm run dev` – app on http://localhost:5173 (copy `.env.example` to `.env`)
- `npm run worker:dev` – AI proxy on http://localhost:8787 (see `worker/README.md`)
- `npm test`, `npm run worker:test`, `npm run e2e`

**Markup and forms.** Tools: highlight, note, draw, rectangle, arrow, text box and sign. Existing form fields can be filled in, with a Clear form button to reset them. Signatures can be drawn, typed or uploaded; "Remember" stores the signature only in this browser's localStorage and it is never sent anywhere. Downloads keep annotations editable in Acrobat and Preview, while signatures are flattened into the page.

**Search.** Enable search once to download about 200 MB of embedding model (EmbeddingGemma 2, Apache 2.0) into the browser. Opened documents are chunked and indexed on this device only, kept in a local library so they stay searchable on later visits, and Ask can answer from the most relevant passages instead of the whole file. Nothing about your documents is sent anywhere; the model files come from Hugging Face's CDN, and the ONNX runtime (WebAssembly or WebGPU backend) is fetched from a CDN on first use and contains no document data. Search needs WebGPU (Chrome, Edge, Safari 26+, Firefox 141+); browsers without it can opt into a CPU mode that downloads about 1 GB per visit. `npm run search:smoke` checks the model locally; `E2E_SEARCH=1 npm run e2e` runs the browser test that downloads it.

**OCR.** Scanned pages are recognized automatically in the browser with Tesseract.js (English; language data is downloaded from jsDelivr and cached). The text powers selection, AI features, search, and is written into downloaded PDFs as an invisible layer. "Deep OCR" sends page images to the AI worker for Claude to transcribe handwriting, tables, and photos; it is opt-in per use and costs one AI request per page. Turn automatic recognition off under the AI panel's "Recognize text automatically".

**Edit text.** Choose *Edit text* (or press `e`), click any paragraph, and change it in place. The original is covered in the page's own background colour and the new text is drawn in the closest of the twelve standard PDF faces (Helvetica, Times, Courier and their bold/italic variants), matched from the original font's name and flags. Edits reflow inside the block, can be reopened, moved, resized, re-fonted or deleted, and are included in Summarize, Ask, Search, and the downloaded PDF. On scanned pages the recognized text is updated too. Pages must be shown unrotated to edit.

Specs and plans live in `docs/superpowers/`.
