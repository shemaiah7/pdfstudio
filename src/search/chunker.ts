import { CHUNK_STEP, CHUNK_WORDS, MIN_WORDS } from "./constants";

export interface Chunk { page: number; start: number; end: number; text: string }

export function chunkPage(page: number, text: string): Chunk[] {
  const words: { start: number; end: number }[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) words.push({ start: m.index, end: m.index + m[0].length });
  if (words.length < MIN_WORDS) return [];
  const out: Chunk[] = [];
  for (let i = 0; ; i += CHUNK_STEP) {
    const slice = words.slice(i, i + CHUNK_WORDS);
    const start = slice[0].start, end = slice[slice.length - 1].end;
    out.push({ page, start, end, text: text.slice(start, end) });
    if (i + CHUNK_WORDS >= words.length) break;
  }
  return out;
}
