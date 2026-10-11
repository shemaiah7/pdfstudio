import type { Box } from "../pdf/types";
import { wrapWords, type Measure, type PlacedLine } from "../pdf/layout";
export interface BlockLayout { lines: PlacedLine[]; boxes: Box[]; height: number; overflowLines: number }

export function layoutBlock(text: string, box: Box, fontSize: number, lineHeight: number, measure: Measure): BlockLayout {
  // Tolerate a 5 % overhang so text that merely rounds past the original width does not wrap.
  const texts = wrapWords(text, box.width * 1.05 + 1, fontSize, measure);
  const top = box.y + box.height;
  const lines: PlacedLine[] = texts.map((t, k) => ({ text: t, x: box.x, baseline: top - fontSize - k * lineHeight, width: box.width }));
  const boxes: Box[] = lines.map((l, k) => ({ x: box.x, y: l.baseline - fontSize * 0.25, width: box.width, height: k === lines.length - 1 ? fontSize * 1.05 : lineHeight }));
  const capacity = Math.max(1, Math.floor((box.height + 0.2 * lineHeight) / lineHeight));
  return { lines, boxes, height: lines.length * lineHeight, overflowLines: Math.max(0, lines.length - capacity) };
}

/** Layout boxes plus, when the new text is shorter than the original block, a box covering the rest of the region. */
export function coverBoxes(layout: BlockLayout, region: Box): Box[] {
  const last = layout.boxes[layout.boxes.length - 1];
  if (!last) return [region];
  const rest = last.y - region.y;
  return rest > 0 ? [...layout.boxes, { x: region.x, y: region.y, width: region.width, height: rest }] : layout.boxes;
}
