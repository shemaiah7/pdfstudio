import { useCallback, useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import PageCanvas from "./PageCanvas";
import TextLayer from "./TextLayer";
import EditOverlay from "./EditOverlay";
import { useToolsStore } from "../store/tools";
import type { Box, Edit, PageEntry, SourceFile } from "../pdf/types";
import BlockEditor from "./BlockEditor";
import { pageBlocks, blockFromEdit, type OpenBlock } from "../edit/pageBlocks";
import { blockAt, blockKeyOf } from "../edit/blocks";
import { fontInfoFor } from "../edit/fontInfo";
import { matchFont } from "../edit/fontMatch";
import { sampleBlockColors } from "../edit/colors";
import { measureFor } from "../pdf/metrics";
import type { PageMeta } from "../pdf/geometry";
import FormLayer from "./FormLayer";
import { useFields } from "./useFields";
import OcrBadge from "./ocr/OcrBadge";
import AnnotationOverlay from "./AnnotationOverlay";

function PageForm({ source, sourceId, sourcePageIndex, meta }: { source: SourceFile; sourceId: string; sourcePageIndex: number; meta: PageMeta }) {
  const fields = useFields(source);
  return fields && fields.length > 0 ? <FormLayer sourceId={sourceId} sourcePageIndex={sourcePageIndex} fields={fields} meta={meta} /> : null;
}

interface Props { scale: number }
type PageMetaPt = { widthPt: number; heightPt: number; pageRotate: number };
const contains = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
const WHITE: [number, number, number] = [1, 1, 1];

/** Crop-relative point (pt, y up) under the pointer. */
function pointAt(pageEl: HTMLElement, clientX: number, clientY: number, scale: number, heightPt: number) {
  const r = pageEl.getBoundingClientRect();
  return { x: (clientX - r.left) / scale, y: heightPt - (clientY - r.top) / scale };
}

export default function PageView({ scale }: Props) {
  const pages = useDocumentStore((s) => s.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selection = useDocumentStore((s) => s.selection);
  const select = useDocumentStore((s) => s.select);
  const edits = useDocumentStore((s) => s.edits);
  const annotations = useDocumentStore((s) => s.annotations);
  const selectAnnotation = useDocumentStore((s) => s.selectAnnotation);
  const tool = useToolsStore((s) => s.tool);
  const [open, setOpen] = useState<OpenBlock | null>(null);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ pageId: string; box: Box } | null>(null);
  const hoverFrame = useRef(0);
  const [heights, setHeights] = useState<Record<string, PageMetaPt>>({});
  const onMeta = useCallback((id: string, m: PageMetaPt) => {
    setHeights((h) => {
      const c = h[id];
      return c && c.widthPt === m.widthPt && c.heightPt === m.heightPt && c.pageRotate === m.pageRotate ? h : { ...h, [id]: m };
    });
  }, []);

  const openFromEdit = (entry: PageEntry, source: SourceFile, existing: Edit): OpenBlock =>
    ({ entry, source, block: blockFromEdit(existing), font: existing.font, colors: { background: existing.background ?? WHITE, text: existing.color }, blockKey: existing.blockKey ?? `edit:${existing.id}`, existing, caretOffset: 0 });

  /** Resolves the block (or existing edit) under a pointer position; null when there is nothing editable. */
  const resolveBlock = async (entry: PageEntry, source: SourceFile, pageEl: HTMLElement, clientX: number, clientY: number, sample = false): Promise<OpenBlock | { empty: true } | { narrow: true } | null> => {
    const meta = heights[entry.id];
    if (!meta) return null;
    const pt = pointAt(pageEl, clientX, clientY, scale, meta.heightPt);
    const existing = useDocumentStore.getState().edits.find((e) => e.pageEntryId === entry.id && e.boxes.some((b) => contains(b, pt.x, pt.y)));
    if (existing) return openFromEdit(entry, source, existing);
    const { blocks, styles, page } = await pageBlocks(source, entry.sourcePageIndex);
    const block = blockAt(blocks, pt.x, pt.y);
    if (!block) return { empty: true };
    const font = matchFont(fontInfoFor(page, block.fontName, styles));
    const measure = await measureFor(font);
    if (block.box.width < measure("W", block.fontSize)) return { narrow: true };
    // Rough caret placement: the character nearest the click on the clicked line.
    let caretOffset = 0;
    const k = Math.min(block.lines.length - 1, Math.max(0, Math.floor((block.box.y + block.box.height - pt.y) / block.lineHeight)));
    if (block.lines.length) {
      for (let i = 0; i < k; i++) caretOffset += block.lines[i].text.length + 1;
      const line = block.lines[k];
      let c = 0;
      while (c < line.text.length && line.x + measure(line.text.slice(0, c + 1), block.fontSize) < pt.x) c++;
      caretOffset += c;
    }
    const canvas = sample ? pageEl.querySelector("canvas") : null;
    const colors = canvas ? sampleBlockColors(canvas, block.box, scale, meta.heightPt) : { background: WHITE, text: [0, 0, 0] as [number, number, number] };
    return { entry, source, block, font, colors, blockKey: blockKeyOf(source.id, entry.sourcePageIndex, block), caretOffset };
  };
  const onEditClick = async (e: React.MouseEvent<HTMLElement>, entry: PageEntry, source: SourceFile) => {
    const meta = heights[entry.id];
    if (!meta) return;
    const { setMessage } = useToolsStore.getState();
    if ((meta.pageRotate + entry.rotation) % 360 !== 0) { setMessage("Rotate the page back to its original orientation to edit text."); return; }
    const pageEl = e.currentTarget, cx = e.clientX, cy = e.clientY;
    const r = await resolveBlock(entry, source, pageEl, cx, cy, true);
    if (!r) return;
    if ("block" in r && r.existing && r.existing.id !== selectedEditId) { setMessage(null); setHint(null); setSelectedEditId(r.existing.id); return; } // first click selects, handles reopen
    setSelectedEditId(null);
    if ("empty" in r) setMessage("No text here.");
    else if ("narrow" in r) setMessage("Block too narrow to edit.");
    else { setMessage(null); setHint(null); setOpen(r); }
  };
  const onEditHover = (e: React.MouseEvent<HTMLElement>, entry: PageEntry, source: SourceFile) => {
    if (open || (heights[entry.id] && (heights[entry.id].pageRotate + entry.rotation) % 360 !== 0)) return;
    const pageEl = e.currentTarget, cx = e.clientX, cy = e.clientY;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      void resolveBlock(entry, source, pageEl, cx, cy).then((r) => setHint(r && "block" in r ? { pageId: entry.id, box: r.block.box } : null)).catch(() => setHint(null));
    });
  };

  return (
    <main className="pageview">
      {pages.map((entry, i) => {
        const source = sources.get(entry.sourceId)!;
        return (
          <div key={entry.id} id={`page-${entry.id}`}
            className={`page ${selection.has(entry.id) ? "selected" : ""} ${tool === "edit" ? "tool-edit" : ""}`}
            data-page-entry={entry.id} data-scale={scale} data-rotation={entry.rotation}
            onMouseMove={tool === "edit" ? (e) => onEditHover(e, entry, source) : undefined}
            onMouseLeave={tool === "edit" ? () => { cancelAnimationFrame(hoverFrame.current); setHint(null); } : undefined}
            onClick={(e) => {
              if ((e.target as Element).closest(".annotationOverlay, .notePopover, .block-editor-wrap, .edit-handles")) return;
              if (useToolsStore.getState().tool === "edit") { void onEditClick(e, entry, source); return; }
              if (useToolsStore.getState().tool !== "select") return;
              selectAnnotation(null);
              if (window.getSelection()?.isCollapsed) select([entry.id], e.metaKey || e.ctrlKey ? "toggle" : "replace");
            }}>
            <PageCanvas source={source} entry={entry} scale={scale} lazy onMeta={(m) => onMeta(entry.id, m)} />
            <TextLayer source={source} entry={entry} scale={scale} />
            {heights[entry.id] ? <EditOverlay edits={edits.filter((e) => e.pageEntryId === entry.id)} scale={scale} pageHeightPt={heights[entry.id].heightPt} pageWidthPt={heights[entry.id].widthPt} rotation={(heights[entry.id].pageRotate + entry.rotation) % 360} selectedEditId={tool === "edit" && !open ? selectedEditId : null} onReopen={(ed) => { setSelectedEditId(null); setHint(null); setOpen(openFromEdit(entry, source, ed)); }} /> : null}
            {heights[entry.id] ? <PageForm sourceId={source.id} source={source} sourcePageIndex={entry.sourcePageIndex} meta={{ widthPt: heights[entry.id].widthPt, heightPt: heights[entry.id].heightPt, scale, rotation: ((heights[entry.id].pageRotate + entry.rotation) % 360) as 0 | 90 | 180 | 270 }} /> : null}
            {heights[entry.id] ? <AnnotationOverlay pageEntryId={entry.id} annotations={annotations.filter((a) => a.pageEntryId === entry.id)} meta={{ widthPt: heights[entry.id].widthPt, heightPt: heights[entry.id].heightPt, scale, rotation: ((heights[entry.id].pageRotate + entry.rotation) % 360) as 0 | 90 | 180 | 270 }} pageEl={() => document.getElementById(`page-${entry.id}`)} /> : null}
            {tool === "edit" && hint && hint.pageId === entry.id && heights[entry.id] ? <div className="block-hint-outline" style={{ left: hint.box.x * scale, top: (heights[entry.id].heightPt - hint.box.y - hint.box.height) * scale, width: hint.box.width * scale, height: hint.box.height * scale }} /> : null}
            {open && open.entry.id === entry.id && heights[entry.id] ? <BlockEditor key={open.blockKey} open={open} scale={scale} heightPt={heights[entry.id].heightPt} onClose={() => setOpen((o) => (o === open ? null : o))} /> : null}
            <div className="page-label">{i + 1}</div>
            <OcrBadge sourceId={source.id} pageIndex={entry.sourcePageIndex} />
          </div>
        );
      })}
    </main>
  );
}
