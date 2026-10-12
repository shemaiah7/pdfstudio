import type { Box } from "../pdf/types";
import type { TextItemBox } from "../pdf/text";

export interface TextRun { items: TextItemBox[]; text: string; fontName: string; fontSize: number; x: number; width: number }
export interface TextLine { text: string; x: number; baseline: number; width: number; fontSize: number; fontName: string; items: TextItemBox[]; runs: TextRun[]; box: Box }
export interface TextBlock { lines: TextLine[]; box: Box; lineHeight: number; fontSize: number; fontName: string; text: string; firstLineIndex: number }

const COLUMN_GAP = 1.2;   // em
const SIZE_TOL = 0.02;

function joinText(items: TextItemBox[]): string {
  let text = "", cursor = -Infinity;
  for (const p of items) {
    const gap = p.x - cursor;
    if (text && gap > p.fontSize * 0.15 && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
    text += p.str; cursor = p.x + p.width;
  }
  return text.replace(/\s+/g, " ").trim();
}

function runsOf(items: TextItemBox[]): TextRun[] {
  const runs: TextItemBox[][] = [];
  for (const p of items) {
    const r = runs[runs.length - 1];
    if (r && r[0].fontName === p.fontName && Math.abs(r[0].fontSize - p.fontSize) <= r[0].fontSize * SIZE_TOL) r.push(p); else runs.push([p]);
  }
  return runs.map((r) => ({ items: r, text: joinText(r), fontName: r[0].fontName, fontSize: r[0].fontSize, x: r[0].x, width: Math.max(...r.map((i) => i.x + i.width)) - r[0].x }));
}

export function lineBox(line: Pick<TextLine, "x" | "baseline" | "width" | "fontSize">): Box {
  return { x: line.x, y: line.baseline - line.fontSize * 0.25, width: line.width, height: line.fontSize * 1.2 };
}

function lineOf(g: TextItemBox[]): TextLine {
  const x = Math.min(...g.map((i) => i.x));
  const right = Math.max(...g.map((i) => i.x + i.width));
  const partial = { text: joinText(g), x, baseline: Math.min(...g.map((i) => i.y)), width: right - x, fontSize: g[0].fontSize, fontName: g[0].fontName, items: g, runs: runsOf(g) };
  return { ...partial, box: lineBox(partial) };
}

export function linesFrom(items: TextItemBox[]): TextLine[] {
  const placed = items.filter((i) => i.str.length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItemBox[][] = [];
  for (const p of placed) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - p.y) <= g[0].fontSize * 0.5) g.push(p); else groups.push([p]);
  }
  const out: TextLine[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    let seg: TextItemBox[] = [];
    for (const p of g) {
      const prev = seg[seg.length - 1];
      if (prev && p.x - (prev.x + prev.width) > COLUMN_GAP * prev.fontSize) { out.push(lineOf(seg)); seg = []; }
      seg.push(p);
    }
    if (seg.length) out.push(lineOf(seg));
  }
  return out;
}

export function linesInBox(lines: TextLine[], box: Box): TextLine[] {
  return lines.filter((l) => {
    const b = l.box;
    const vy = Math.min(b.y + b.height, box.y + box.height) - Math.max(b.y, box.y);
    const vx = Math.min(b.x + b.width, box.x + box.width) - Math.max(b.x, box.x);
    return vy >= b.height / 2 && vx >= l.fontSize * 0.5;
  });
}

export function lineAt(lines: TextLine[], x: number, y: number, tol = 2): TextLine | undefined {
  return lines.find((l) => x >= l.box.x - tol && x <= l.box.x + l.box.width + tol && y >= l.box.y - tol && y <= l.box.y + l.box.height + tol);
}

function joins(a: TextLine, b: TextLine): boolean {
  const gap = a.baseline - b.baseline - a.fontSize;
  return Math.abs(a.x - b.x) <= a.fontSize * 0.5 && gap >= 0 && gap <= a.fontSize * 1.6 && a.fontName === b.fontName && Math.abs(a.fontSize - b.fontSize) <= a.fontSize * 0.1;
}

export function blocksFrom(lines: TextLine[]): TextBlock[] {
  const out: TextBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const group = [lines[i]];
    let j = i + 1;
    while (j < lines.length && joins(group[group.length - 1], lines[j])) group.push(lines[j++]);
    const fontSize = group[0].fontSize;
    const lineHeight = group.length > 1 ? (group[0].baseline - group[group.length - 1].baseline) / (group.length - 1) : fontSize * 1.2;
    const x = Math.min(...group.map((l) => l.x));
    const right = Math.max(...group.map((l) => l.x + l.width));
    const y = group[group.length - 1].baseline - fontSize * 0.25;
    const top = group[0].baseline + fontSize;
    out.push({ lines: group, box: { x, y, width: right - x, height: top - y }, lineHeight, fontSize, fontName: group[0].fontName, text: group.map((l) => l.text).join("\n"), firstLineIndex: i });
    i = j;
  }
  return out;
}

export function blockAt(blocks: TextBlock[], x: number, y: number, tol = 2): TextBlock | undefined {
  return blocks.find((b) => x >= b.box.x - tol && x <= b.box.x + b.box.width + tol && y >= b.box.y - tol && y <= b.box.y + b.box.height + tol);
}

export function blockKeyOf(sourceId: string, pageIndex: number, block: TextBlock): string { return `${sourceId}:${pageIndex}:${block.firstLineIndex}`; }
