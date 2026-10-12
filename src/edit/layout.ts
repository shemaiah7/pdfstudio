import type { Box, Edit, EditFont, RGB } from "../pdf/types";
import { normalizeFont } from "../pdf/fonts";
import { layoutInBoxes, regionOf, wrapWords, type Measure, type PlacedLine } from "../pdf/layout";
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
  return rest > 0.01 ? [...layout.boxes, { x: region.x, y: region.y, width: region.width, height: rest }] : layout.boxes;
}

type EditGeometry = Pick<Edit, "text" | "fontSize" | "lineHeight" | "boxes" | "region" | "frame">;

/**
 * Layout of an edit from its text frame (`frame`, else the original `region`, else the bounds of its boxes).
 * `boxes` are the cover rectangles: the layout plus the unused remainder of the frame, and, once the frame has
 * moved or resized, the original region too, so the original text stays covered.
 */
export function layoutEdit(edit: EditGeometry, measure: Measure): { lines: PlacedLine[]; boxes: Box[]; layout: BlockLayout } {
  const region = edit.region ?? regionOf(edit.boxes);
  const frame = edit.frame ?? region;
  const layout = layoutBlock(edit.text, frame, edit.fontSize, edit.lineHeight ?? 1.2 * edit.fontSize, measure);
  const boxes = coverBoxes(layout, frame);
  return { lines: layout.lines, boxes: edit.frame && edit.region ? [...boxes, edit.region] : boxes, layout };
}

/** The one layout used by overlay, export, flatten and text extraction. Edits without a `region` (legacy) keep the per-box layout. */
export function placeEdit(edit: EditGeometry, measure: Measure): { lines: PlacedLine[]; boxes: Box[]; fontSize: number } {
  if (edit.region || edit.frame) {
    const { lines, boxes } = layoutEdit(edit, measure);
    return { lines, boxes, fontSize: edit.fontSize };
  }
  const { lines, fontSize } = layoutInBoxes(edit.text, edit.boxes, edit.fontSize, measure, { keepOverflow: true });
  return { lines, boxes: edit.boxes, fontSize };
}

export interface Piece { text: string; x: number; baseline: number; width: number; font: EditFont; fontSize: number; color: RGB }
export type Measures = (font: EditFont) => Measure;

export function lineFrame(edit: Pick<Edit, "frame" | "region" | "boxes">): Box {
  return edit.frame ?? edit.region ?? regionOf(edit.boxes);
}

/**
 * The one layout for every edit kind. Line edits: runs left to right from (x, baseline), shifted by the frame's offset
 * from the region when moved; covers are the original region plus the frame when moved. Legacy block edits: the
 * existing `placeEdit` layout, one piece per line in the block's font.
 */
export function placePieces(edit: Edit, measures: Measures): { pieces: Piece[]; boxes: Box[] } {
  if (edit.kind === "line") {
    const region = edit.region ?? regionOf(edit.boxes);
    const frame = edit.frame ?? region;
    const dx = frame.x - region.x, dy = frame.y - region.y;
    let x = (edit.x ?? region.x) + dx;
    const baseline = (edit.baseline ?? region.y + region.height * 0.25 / 1.2) + dy;
    const pieces: Piece[] = [];
    for (const r of edit.runs ?? []) {
      if (!r.text) continue;
      const width = measures(r.font)(r.text, r.fontSize);
      pieces.push({ text: r.text, x, baseline, width, font: r.font, fontSize: r.fontSize, color: r.color });
      x += width;
    }
    return { pieces, boxes: edit.frame ? [region, frame] : [region] };
  }
  const font = normalizeFont(edit.font);
  const { lines, boxes, fontSize } = placeEdit(edit, measures(font));
  return { pieces: lines.map((l) => ({ text: l.text, x: l.x, baseline: l.baseline, width: measures(font)(l.text, fontSize), font, fontSize, color: edit.color })), boxes };
}
