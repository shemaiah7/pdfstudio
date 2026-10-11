import type { Box } from "./types";

export interface Region { x: number; y: number; width: number; height: number }
export interface Line { text: string; x: number; baseline: number }
export type Measure = (text: string, fontSize: number) => number;

export function regionOf(boxes: Box[]): Region {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: top - y };
}

export function wrapWords(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      // break long words by character
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch, size) > width && chunk) { lines.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

const STEPS = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];

export function layoutText(text: string, region: Region, fontSize: number, measure: Measure) {
  let chosen = { size: fontSize * 0.7, lines: [] as string[], overflow: true };
  for (const step of STEPS) {
    const size = fontSize * step;
    const lines = wrapWords(text, region.width, size, measure);
    const fits = lines.length * size * 1.2 <= region.height + size * 0.2;
    if (fits) { chosen = { size, lines, overflow: false }; break; }
    if (step === STEPS[STEPS.length - 1]) chosen = { size, lines, overflow: true };
  }
  const maxLines = Math.max(1, Math.floor((region.height + chosen.size * 0.2) / (chosen.size * 1.2)));
  const visible = chosen.overflow ? chosen.lines.slice(0, maxLines) : chosen.lines;
  const top = region.y + region.height;
  return {
    fontSize: chosen.size,
    overflow: chosen.overflow,
    lines: visible.map((t, i) => ({ text: t, x: region.x, baseline: top - chosen.size - i * chosen.size * 1.2 })),
  };
}

export interface PlacedLine { text: string; x: number; baseline: number; width: number }

/** Wrap sequentially: line k is limited to widths[k] (extra lines reuse the last width). */
function wrapSequential(text: string, widths: number[], size: number, measure: Measure): string[] {
  const lines: string[] = [];
  // Tolerate a 5 % overhang so text that merely rounds past the original width does not wrap.
  const widthFor = () => widths[Math.min(lines.length, widths.length - 1)] * 1.05 + 1;
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= widthFor()) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch, size) > widthFor() && chunk) { lines.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Lay text out one line per selected line box (top to bottom), using each box's own x and width,
 * so replacement text never lands over unselected text. With `keepOverflow`, lines that do not fit
 * are still returned (below the last box) instead of being dropped.
 */
export function layoutInBoxes(text: string, boxes: Box[], fontSize: number, measure: Measure, opts: { keepOverflow?: boolean } = {}) {
  const sorted = [...boxes].sort((a, b) => b.y + b.height - (a.y + a.height) || a.x - b.x);
  const widths = sorted.map((b) => b.width);
  const place = (lines: string[], size: number): PlacedLine[] =>
    lines.map((t, k) => {
      if (k < sorted.length) {
        const b = sorted[k];
        return { text: t, x: b.x, baseline: b.y + b.height - size * 0.85, width: b.width };
      }
      const last = sorted[sorted.length - 1];
      const lastBaseline = last.y + last.height - size * 0.85;
      return { text: t, x: last.x, baseline: lastBaseline - (k - sorted.length + 1) * size * 1.2, width: last.width };
    });
  let size = fontSize;
  let lines: string[] = [];
  for (const step of STEPS) {
    size = fontSize * step;
    lines = wrapSequential(text, widths, size, measure);
    if (lines.length <= sorted.length) return { lines: place(lines, size), fontSize: size, overflow: false };
  }
  return { lines: place(opts.keepOverflow ? lines : lines.slice(0, sorted.length), size), fontSize: size, overflow: true };
}
