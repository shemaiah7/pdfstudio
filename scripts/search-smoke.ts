// scripts/search-smoke.ts  — run: npx tsx scripts/search-smoke.ts
import { loadEmbedModel, embedTexts } from "../src/search/embedModel";
import { DIMS } from "../src/search/constants";

const files = new Set<string>();
const model = await loadEmbedModel("cpu", (p) => { if (p.file) files.add(p.file); });
console.log("files", [...files]);
const raw = "chest pain radiating to the left arm";
const q = await embedTexts(model, [raw], "query");
const docs = await embedTexts(model, [
  "The patient reported substernal chest pressure radiating to the left arm, relieved by nitroglycerin.",
  "A pruritic erythematous rash on the forearm responded to topical corticosteroids.",
  raw,
], "document");
console.log("dims", [1 + 3, DIMS], q.length, docs.length);
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
const d = (i: number) => docs.subarray(i * DIMS, (i + 1) * DIMS);
const cardiac = dot(q, d(0)), derm = dot(q, d(1)), samePrefixDiff = dot(q, d(2));
console.log({ cardiac, derm, samePrefixDiff });
if (!(cardiac > derm)) throw new Error("cardiac passage should outrank dermatology");
if (samePrefixDiff > 0.999) throw new Error("query and document prefixes produced identical vectors; prefixes are not applied");
console.log("OK");
