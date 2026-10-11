import { describe, it, expect } from "vitest";
import { rank, queryTerms, truncateNormalize } from "./ranker";
import { DIMS } from "./constants";
import type { RankDoc } from "./ranker";

const unit = (i: number) => { const v = new Float32Array(DIMS); v[i] = 1; return v; };
const doc = (hash: string, vecs: Float32Array[], texts: string[]): RankDoc => {
  const vectors = new Float32Array(vecs.length * DIMS);
  vecs.forEach((v, i) => vectors.set(v, i * DIMS));
  return { hash, chunks: texts.map((text, i) => ({ page: i, start: 0, end: text.length, text })), vectors };
};

describe("queryTerms", () => {
  it("lowercases, drops short words and stop words, dedupes", () => {
    expect(queryTerms("The Warfarin dose, the warfarin DOSE!")).toEqual(["warfarin", "dose"]);
    expect(queryTerms("a of the")).toEqual([]);
  });
});

describe("truncateNormalize", () => {
  it("keeps the first DIMS values and renormalises", () => {
    const v = new Float32Array(768).fill(0); v[0] = 3; v[1] = 4; v[700] = 100;
    const t = truncateNormalize(v);
    expect(t.length).toBe(DIMS);
    expect(t[0]).toBeCloseTo(0.6); expect(t[1]).toBeCloseTo(0.8);
  });
});

describe("rank", () => {
  it("orders by cosine and drops hits under the threshold", () => {
    const d = doc("h", [unit(0), unit(1), unit(2)], ["zero", "one", "two"]);
    const q = new Float32Array(DIMS); q[0] = 0.8; q[1] = 0.6;
    const hits = rank(q, [d], []);
    expect(hits.map((h) => [h.chunkIndex, +h.score.toFixed(2)])).toEqual([[0, 0.8], [1, 0.6]]);
  });
  it("boosts exact terms by 0.05 each, capped at 0.15, and snippets around the first term", () => {
    const d = doc("h", [unit(0), unit(0)], ["nothing here", "warfarin dose adjusted; warfarin held, dose halved, inr checked"]);
    const q = unit(0);
    const hits = rank(q, [d], ["warfarin", "dose", "inr", "held"]);
    expect(hits[0].chunkIndex).toBe(1);
    expect(hits[0].score).toBeCloseTo(1.15);
    expect(hits[0].snippet.startsWith("warfarin dose")).toBe(true);
    expect(hits[1].score).toBeCloseTo(1);
  });
  it("allows at most 3 hits per document in the first 10", () => {
    const a = doc("a", Array.from({ length: 8 }, () => unit(0)), Array.from({ length: 8 }, (_, i) => `a${i}`));
    const b = doc("b", [unit(1)], ["b0"]);
    const q = new Float32Array(DIMS); q[0] = 0.9; q[1] = 0.5;
    const hits = rank(q, [a, b], []);
    expect(hits.slice(0, 4).map((h) => h.hash)).toEqual(["a", "a", "a", "b"]);
    expect(hits.length).toBe(9);
  });
  it("excludes the originating chunk and honours limit", () => {
    const d = doc("h", [unit(0), unit(0), unit(0)], ["x", "y", "z"]);
    const hits = rank(unit(0), [d], [], { limit: 1, exclude: { hash: "h", chunkIndex: 0 } });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkIndex).toBe(1);
  });
  it("truncates snippets to 240 characters", () => {
    const long = "word ".repeat(100).trim();
    const hits = rank(unit(0), [doc("h", [unit(0)], [long])], []);
    expect(hits[0].snippet.length).toBeLessThanOrEqual(241);
  });
});
