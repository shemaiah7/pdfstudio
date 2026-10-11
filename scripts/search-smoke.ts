// scripts/search-smoke.ts  — run: npx tsx scripts/search-smoke.ts
import { pipeline } from "@huggingface/transformers";
import { DOC_PREFIX, MODEL_ID, QUERY_PREFIX } from "../src/search/constants";
import { truncateNormalize } from "../src/search/ranker";

const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q4", device: "cpu" });
const texts = [
  QUERY_PREFIX + "chest pain radiating to the left arm",
  DOC_PREFIX + "The patient reported substernal chest pressure radiating to the left arm, relieved by nitroglycerin.",
  DOC_PREFIX + "A pruritic erythematous rash on the forearm responded to topical corticosteroids.",
  DOC_PREFIX + "chest pain radiating to the left arm",
];
const r = await extractor(texts, { pooling: "mean", normalize: true });
console.log("dims", r.dims);
const width = (r.dims as number[]).at(-1)!;
const data = r.data as Float32Array;
const v = (i: number) => truncateNormalize(data.subarray(i * width, (i + 1) * width));
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
const cardiac = dot(v(0), v(1)), derm = dot(v(0), v(2)), samePrefixDiff = dot(v(0), v(3));
console.log({ cardiac, derm, samePrefixDiff });
if (!(cardiac > derm)) throw new Error("cardiac passage should outrank dermatology");
if (samePrefixDiff > 0.999) throw new Error("query and document prefixes produced identical vectors; prefixes are not applied");
console.log("OK");
