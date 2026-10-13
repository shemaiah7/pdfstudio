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

const ONES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const NUM = `(\\d{1,4}|${ONES.join("|")})`;
const toNum = (t: string): number => (/^\d+$/.test(t) ? Number(t) : ONES.indexOf(t) + 1);

/** Explicit page references in a spoken/typed query ("page 4", "pages 4 and 6", "p. 4", "p4", "pg 4", "page four"), in order, deduped, within 1..pageCount, at most 3. */
export function pagesNamed(query: string, pageCount: number): number[] {
  const q = query.toLowerCase();
  const out: number[] = [];
  const add = (n: number) => { if (n >= 1 && n <= pageCount && !out.includes(n)) out.push(n); };
  const re = new RegExp(`\\b(?:pages?|pgs?\\.?|p\\.?)\\s*${NUM}\\b((?:\\s*(?:,|and|&|or)\\s*${NUM}\\b)*)`, "g");
  for (const m of q.matchAll(re)) {
    add(toNum(m[1]));
    for (const x of m[2].matchAll(new RegExp(NUM, "g"))) add(toNum(x[1]));
  }
  return out.slice(0, 3);
}

const WORDLIKE = /^[a-z]+(?:['’-][a-z]+)*$/i;
/** Text that looks like OCR noise (e.g. Tesseract on handwriting): too few word-like tokens. */
export function looksGarbled(text: string): boolean {
  const tokens = text.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 8) return false;
  const wordlike = tokens.filter((t) => {
    const core = t.replace(/[.,;:!?)"'\]]+$/, "").replace(/^[("'[]+/, "");
    return core.length >= 2 && WORDLIKE.test(core) && /[aeiouy]/i.test(core) && !/[^aeiouy\W\d_'’-]{5,}/i.test(core);
  }).length;
  return wordlike / tokens.length < 0.55;
}
