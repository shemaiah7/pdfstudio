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

function wrap(text: string, width: number, size: number, measure: Measure): string[] {
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
    const lines = wrap(text, region.width, size, measure);
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
