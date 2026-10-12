import { queryTerms } from "../search/ranker";

export const NO_MATCH = "No passage in the document matched that query.";

/** "[p. N] text" blocks joined by blank lines, cut at a passage boundary so the result stays within maxChars. */
export function formatPassages(passages: { page: number; text: string }[], maxChars = 4000): string {
  const blocks: string[] = [];
  let used = 0;
  for (const p of passages) {
    const block = `[p. ${p.page}] ${p.text.trim()}`;
    const sep = blocks.length ? 2 : 0;
    if (used + sep + block.length > maxChars) {
      if (blocks.length === 0) blocks.push(block.slice(0, maxChars));
      break;
    }
    blocks.push(block);
    used += sep + block.length;
  }
  return blocks.join("\n\n");
}

/** Fallback when the embedding model is not available: pages ranked by distinct query-term hits, 600-char window around the first hit. */
export function keywordPassages(pages: { page: number; text: string }[], query: string, limit = 3): { page: number; text: string }[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const scored: { page: number; text: string; hits: number; first: number }[] = [];
  for (const p of pages) {
    const lower = p.text.toLowerCase();
    let hits = 0; let first = -1;
    for (const t of terms) {
      const i = lower.indexOf(t);
      if (i >= 0) { hits++; if (first < 0 || i < first) first = i; }
    }
    if (hits > 0) scored.push({ page: p.page, text: p.text, hits, first });
  }
  scored.sort((a, b) => b.hits - a.hits || a.page - b.page);
  return scored.slice(0, limit).map((s) => {
    const start = Math.max(0, s.first - 200);
    return { page: s.page, text: s.text.slice(start, start + 600).trim() };
  });
}

export function overview(name: string, pageCount: number): string {
  return `Document: ${name}, ${pageCount} pages.`;
}
