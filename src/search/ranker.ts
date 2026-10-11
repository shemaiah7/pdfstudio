import type { Chunk } from "./chunker";
import { BOOST, BOOST_CAP, DIMS, SEARCH_LIMIT, THRESHOLD } from "./constants";

export interface RankDoc { hash: string; chunks: Chunk[]; vectors: Float32Array }
export interface Hit { hash: string; page: number; chunkIndex: number; score: number; snippet: string }

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "what", "which", "who", "how", "does", "not", "but", "has", "have", "had", "can", "any", "all", "into", "than", "then", "its", "our", "your", "their", "about", "when", "where", "there", "they", "them", "you", "did", "will", "would", "should", "could"]);

const SHORT_STOP = new Set(["a", "an", "of", "to", "in", "is", "it", "on", "at", "as", "or", "be", "by", "do", "if", "so", "we", "i"]);
/** True when the query has at least one token (of any length) that is not a stop word. */
export function hasSearchableToken(q: string): boolean {
  return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((t) => t.length > 0 && !STOP.has(t) && !SHORT_STOP.has(t));
}

export function queryTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !STOP.has(t)))];
}

export function truncateNormalize(v: Float32Array | number[], dims = DIMS): Float32Array {
  const out = new Float32Array(dims);
  let norm = 0;
  for (let i = 0; i < dims; i++) { out[i] = v[i] ?? 0; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) out[i] /= norm;
  return out;
}

function dot(q: Float32Array, m: Float32Array, row: number): number {
  let s = 0; const base = row * DIMS;
  for (let i = 0; i < DIMS; i++) s += q[i] * m[base + i];
  return s;
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = at < 0 ? 0 : Math.max(0, at - 80);
  const s = text.slice(start, start + 240).trim();
  return (start > 0 ? "…" : "") + s + (start + 240 < text.length ? "…" : "");
}

export function rank(query: Float32Array, docs: RankDoc[], terms: string[], opts: { limit?: number; exclude?: { hash: string; chunkIndex: number } } = {}): Hit[] {
  const limit = opts.limit ?? SEARCH_LIMIT;
  const all: Hit[] = [];
  for (const d of docs) {
    for (let i = 0; i < d.chunks.length; i++) {
      if (opts.exclude && opts.exclude.hash === d.hash && opts.exclude.chunkIndex === i) continue;
      const chunk = d.chunks[i];
      const lower = chunk.text.toLowerCase();
      let boost = 0;
      for (const t of terms) if (lower.includes(t)) boost = Math.min(BOOST_CAP, boost + BOOST);
      const score = dot(query, d.vectors, i) + boost;
      if (!(score >= THRESHOLD)) continue; // also drops NaN (short or stale vectors)
      all.push({ hash: d.hash, page: chunk.page, chunkIndex: i, score, snippet: snippet(chunk.text, terms) });
    }
  }
  all.sort((a, b) => b.score - a.score);
  // Diversity: at most 3 hits per document among the first 10 results. Hits over that cap
  // are not dropped: they go to `tail`, which is appended after the head. So when fewer than
  // 10 diverse hits exist, over-cap hits backfill the list, but other documents still rank first.
  // Intended behaviour (ruling): no valid hit is dropped.
  const head: Hit[] = [], tail: Hit[] = [], perDoc = new Map<string, number>();
  for (const h of all) {
    const n = perDoc.get(h.hash) ?? 0;
    if (head.length < 10 && n < 3) { head.push(h); perDoc.set(h.hash, n + 1); } else tail.push(h);
  }
  return [...head, ...tail].slice(0, limit);
}
