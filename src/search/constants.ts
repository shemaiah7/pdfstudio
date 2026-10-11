export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
export const DIMS = 256;
export type Dtype = "q4" | "fp32";
export const modelTag = (dtype: Dtype) => `${MODEL_ID}@${DIMS}@${dtype}`;
export const MODEL_TAG = modelTag("q4");
export const CHUNK_WORDS = 200;
export const CHUNK_STEP = 160;
export const MIN_WORDS = 3;
export const THRESHOLD = 0.3;
export const BOOST = 0.05;
export const BOOST_CAP = 0.15;
export const SEARCH_LIMIT = 20;
export const ASK_PASSAGES = 12;
export const EMBED_BATCH = 16;
export const QUERY_PREFIX = "task: search result | query: ";
export const DOC_PREFIX = "title: none | text: ";
// Must match the installed onnxruntime-web version in package-lock.json (production loads its runtime from the CDN).
export const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
export const cdnWasmPaths = (version: string) => `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
