import type { Box } from "../pdf/types";
import type { TextItemBox } from "../pdf/text";

export interface TextLine { text: string; x: number; baseline: number; width: number; fontSize: number; fontName: string; items: TextItemBox[] }
export interface TextBlock { lines: TextLine[]; box: Box; lineHeight: number; fontSize: number; fontName: string; text: string; firstLineIndex: number }

export function linesFrom(items: TextItemBox[]): TextLine[] {
  const placed = items.filter((i) => i.str.length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItemBox[][] = [];
  for (const p of placed) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - p.y) <= g[0].fontSize * 0.5) g.push(p); else groups.push([p]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = "", cursor = -Infinity;
    for (const p of g) {
      const gap = p.x - cursor;
      if (text && gap > p.fontSize * 0.15 && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
      text += p.str; cursor = p.x + p.width;
    }
    const x = Math.min(...g.map((i) => i.x));
    const right = Math.max(...g.map((i) => i.x + i.width));
    return { text: text.replace(/\s+/g, " ").trim(), x, baseline: Math.min(...g.map((i) => i.y)), width: right - x, fontSize: g[0].fontSize, fontName: g[0].fontName, items: g };
  });
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
