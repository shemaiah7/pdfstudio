import type { Box } from "../pdf/types";
import { wrapWords, type Measure, type PlacedLine } from "../pdf/layout";
export interface BlockLayout { lines: PlacedLine[]; boxes: Box[]; height: number; overflowLines: number }

export function layoutBlock(text: string, box: Box, fontSize: number, lineHeight: number, measure: Measure): BlockLayout {
  const texts = wrapWords(text, box.width, fontSize, measure);
  const top = box.y + box.height;
  const lines: PlacedLine[] = texts.map((t, k) => ({ text: t, x: box.x, baseline: top - fontSize * 0.8 - k * lineHeight, width: box.width }));
  const boxes: Box[] = lines.map((l, k) => ({ x: box.x, y: l.baseline - fontSize * 0.25, width: box.width, height: k === lines.length - 1 ? fontSize * 1.05 : lineHeight }));
  const capacity = Math.max(1, Math.floor((box.height + 0.2 * lineHeight) / lineHeight));
  return { lines, boxes, height: lines.length * lineHeight, overflowLines: Math.max(0, lines.length - capacity) };
}
