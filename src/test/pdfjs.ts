import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Directory pdf.js reads its wasm decoders (JBIG2, JPX) from under Node: a path, not a URL. */
export const NODE_WASM_URL = join(process.cwd(), "node_modules/pdfjs-dist/wasm/");

export function openPdf(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice(), wasmUrl: NODE_WASM_URL }).promise;
}
