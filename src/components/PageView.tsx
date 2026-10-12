import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDocumentStore } from "../store/document";
import PageCanvas from "./PageCanvas";
import TextLayer from "./TextLayer";
import EditOverlay from "./EditOverlay";
import { useToolsStore } from "../store/tools";
import type { Box, Edit, PageEntry, SourceFile } from "../pdf/types";
import BlockEditor from "./BlockEditor";
import { pageBlocks, blockFromEdit, type OpenBlock } from "../edit/pageBlocks";
import { lineAt } from "../edit/blocks";
import { sampleBlockColors } from "../edit/colors";
import { lineFrame } from "../edit/layout";
import { openLinesIn } from "../edit/openLines";
import type { OpenLines } from "../edit/runs";
import LineEditor from "./LineEditor";
import DragBox, { useDragBox } from "./DragBox";
import type { PageMeta } from "../pdf/geometry";
import FormLayer from "./FormLayer";
import { useFields } from "./useFields";
import OcrBadge from "./ocr/OcrBadge";
import AnnotationOverlay from "./AnnotationOverlay";

function PageForm({ source, sourceId, sourcePageIndex, meta }: { source: SourceFile; sourceId: string; sourcePageIndex: number; meta: PageMeta }) {
  const fields = useFields(source);
  return fields && fields.length > 0 ? <FormLayer sourceId={sourceId} sourcePageIndex={sourcePageIndex} fields={fields} meta={meta} /> : null;
}

/** Subscribes to just this page's edits, so editing one page does not re-render the others. */
function PageEditLayer({ pageEntryId, ...rest }: { pageEntryId: string } & Omit<React.ComponentProps<typeof EditOverlay>, "edits">) {
  const edits = useDocumentStore(useShallow((s) => s.edits.filter((e) => e.pageEntryId === pageEntryId)));
  return <EditOverlay edits={edits} {...rest} />;
}

/** Per-page drag state: pointer handlers on a layer under the overlays, so handles and editors above it receive their own events. */
function EditTargetLayer({ scale, heightPt, onSelect }: { scale: number; heightPt: number; onSelect(box: Box | null, pt: { x: number; y: number }): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragBox(onSelect, (cx, cy) => pointAt(ref.current!.closest(".page") as HTMLElement, cx, cy, scale, heightPt));
  return (
    <div ref={ref} className="edit-target-layer" {...drag.handlers} onPointerDown={(e) => { if ((e.target as Element).closest(".annotationOverlay, .notePopover, .line-editor, .block-editor-wrap, .edit-handles")) return; drag.handlers.onPointerDown(e); }}>
      <DragBox box={drag.box} scale={scale} heightPt={heightPt} />
    </div>
  );
}

export const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
/** The hover outline keeps its own state, so moving the pointer re-renders only this page's outline, and only when the block changes. */
export function BlockHint({ pageId, scale, heightPt, register }: { pageId: string; scale: number; heightPt: number; register(pageId: string, set: ((b: Box | null) => void) | null): void }) {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    register(pageId, (next) => setBox((prev) => (sameBox(prev, next) ? prev : next)));
    return () => register(pageId, null);
  }, [pageId, register]);
  return box ? <div className="block-hint-outline" style={{ left: box.x * scale, top: (heightPt - box.y - box.height) * scale, width: box.width * scale, height: box.height * scale }} /> : null;
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
  const annotations = useDocumentStore((s) => s.annotations);
  const selectAnnotation = useDocumentStore((s) => s.selectAnnotation);
  const tool = useToolsStore((s) => s.tool);
  const [open, setOpen] = useState<OpenBlock | null>(null);
  const [openLines, setOpenLines] = useState<OpenLines | null>(null);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const selectedExists = useDocumentStore((s) => !!selectedEditId && s.edits.some((e) => e.id === selectedEditId));
  useEffect(() => {
    if (selectedEditId && (tool !== "edit" || !selectedExists)) setSelectedEditId(null);
  }, [tool, selectedExists, selectedEditId]);
  const hoverFrame = useRef(0);
  const hintSetters = useRef(new Map<string, (b: Box | null) => void>());
  const hintPage = useRef<string | null>(null);
  const registerHint = useCallback((id: string, set: ((b: Box | null) => void) | null) => { if (set) hintSetters.current.set(id, set); else hintSetters.current.delete(id); }, []);
  /** Shows the outline on one page (or clears it); each page's outline updates itself only when the box changes. */
  const setHint = (pageId: string | null, box: Box | null) => {
    if (hintPage.current && hintPage.current !== pageId) hintSetters.current.get(hintPage.current)?.(null);
    hintPage.current = box ? pageId : null;
    if (pageId) hintSetters.current.get(pageId)?.(box);
  };
  const [heights, setHeights] = useState<Record<string, PageMetaPt>>({});
  const onMeta = useCallback((id: string, m: PageMetaPt) => {
    setHeights((h) => {
      const c = h[id];
      return c && c.widthPt === m.widthPt && c.heightPt === m.heightPt && c.pageRotate === m.pageRotate ? h : { ...h, [id]: m };
    });
  }, []);

  const openFromEdit = (entry: PageEntry, source: SourceFile, existing: Edit): OpenBlock =>
    ({ entry, source, block: blockFromEdit(existing), font: existing.font, colors: { background: existing.background ?? WHITE, text: existing.color }, blockKey: existing.blockKey ?? `edit:${existing.id}`, existing, caretOffset: 0 });

  /** Existing edit whose area holds the point, if any. */
  const editAt = (entry: PageEntry, pt: { x: number; y: number }) =>
    useDocumentStore.getState().edits.find((e) => e.pageEntryId === entry.id && (e.boxes.some((b) => contains(b, pt.x, pt.y)) || (e.kind === "line" && contains(lineFrame(e), pt.x, pt.y))));

  /** Opens the line editor for the lines in `box`, sampling colours from the drawn page. */
  const openLinesAt = async (entry: PageEntry, source: SourceFile, meta: PageMetaPt, box: Box): Promise<boolean> => {
    const text = await pageBlocks(source, entry.sourcePageIndex);
    const canvas = document.getElementById(`page-${entry.id}`)?.querySelector("canvas");
    const colors = canvas ? sampleBlockColors(canvas, box, scale, meta.heightPt) : { background: WHITE, text: [0, 0, 0] as [number, number, number] };
    const lines = await openLinesIn(text, source, entry, box, colors);
    if (!lines) return false;
    setHint(null, null);
    setOpen(null);
    setOpenLines(lines);
    return true;
  };
  const onEditSelect = async (entry: PageEntry, source: SourceFile, box: Box | null, pt: { x: number; y: number }) => {
    const meta = heights[entry.id];
    if (!meta) return;
    const { setMessage } = useToolsStore.getState();
    if ((meta.pageRotate + entry.rotation) % 360 !== 0) { setMessage("Rotate the page back to its original orientation to edit text."); return; }
    try {
      if (!box) {
        const existing = editAt(entry, pt);
        if (existing && existing.kind !== "line") { // legacy block edit: first click selects, handles / second click reopen
          if (existing.id !== selectedEditId) { setMessage(null); setHint(null, null); setSelectedEditId(existing.id); return; }
          setSelectedEditId(null); setMessage(null); setHint(null, null); setOpenLines(null); setOpen(openFromEdit(entry, source, existing));
          return;
        }
        setSelectedEditId(null);
        let target: Box | null = existing ? lineFrame(existing) : null;
        if (!target) target = lineAt((await pageBlocks(source, entry.sourcePageIndex)).lines, pt.x, pt.y)?.box ?? null;
        if (target && (await openLinesAt(entry, source, meta, target))) { setMessage(null); return; }
        setMessage("No text here to edit");
        return;
      }
      setSelectedEditId(null);
      if (await openLinesAt(entry, source, meta, box)) setMessage(null);
      else setMessage("No text here to edit");
    } catch { setMessage("No text here to edit"); }
  };
  const onEditHover = (e: React.MouseEvent<HTMLElement>, entry: PageEntry, source: SourceFile) => {
    if (open || openLines || (heights[entry.id] && (heights[entry.id].pageRotate + entry.rotation) % 360 !== 0)) return;
    const pageEl = e.currentTarget, cx = e.clientX, cy = e.clientY;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      const meta = heights[entry.id];
      if (!meta) return;
      const pt = pointAt(pageEl, cx, cy, scale, meta.heightPt);
      const existing = editAt(entry, pt);
      if (existing) { setHint(entry.id, lineFrame(existing)); return; }
      void pageBlocks(source, entry.sourcePageIndex).then((t) => { const line = lineAt(t.lines, pt.x, pt.y); setHint(line ? entry.id : null, line?.box ?? null); }).catch(() => setHint(null, null));
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
            onMouseLeave={tool === "edit" ? () => { cancelAnimationFrame(hoverFrame.current); setHint(null, null); } : undefined}
            onClick={(e) => {
              if ((e.target as Element).closest(".annotationOverlay, .notePopover, .line-editor, .block-editor-wrap, .edit-handles")) return;
              if (useToolsStore.getState().tool === "edit") return; // edit targeting is handled by EditTargetLayer pointer events
              if (useToolsStore.getState().tool !== "select") return;
              selectAnnotation(null);
              if (window.getSelection()?.isCollapsed) select([entry.id], e.metaKey || e.ctrlKey ? "toggle" : "replace");
            }}>
            <PageCanvas source={source} entry={entry} scale={scale} lazy onMeta={(m) => onMeta(entry.id, m)} />
            <TextLayer source={source} entry={entry} scale={scale} />
            {tool === "edit" && heights[entry.id] ? <EditTargetLayer scale={scale} heightPt={heights[entry.id].heightPt} onSelect={(box, pt) => void onEditSelect(entry, source, box, pt)} /> : null}
            {heights[entry.id] ? <PageEditLayer pageEntryId={entry.id} scale={scale} pageHeightPt={heights[entry.id].heightPt} pageWidthPt={heights[entry.id].widthPt} rotation={(heights[entry.id].pageRotate + entry.rotation) % 360} selectedEditId={tool === "edit" && !open ? selectedEditId : null} onReopen={(ed) => { setSelectedEditId(null); setHint(null, null); setOpenLines(null); setOpen(openFromEdit(entry, source, ed)); }} /> : null}
            {heights[entry.id] ? <PageForm sourceId={source.id} source={source} sourcePageIndex={entry.sourcePageIndex} meta={{ widthPt: heights[entry.id].widthPt, heightPt: heights[entry.id].heightPt, scale, rotation: ((heights[entry.id].pageRotate + entry.rotation) % 360) as 0 | 90 | 180 | 270 }} /> : null}
            {heights[entry.id] ? <AnnotationOverlay pageEntryId={entry.id} annotations={annotations.filter((a) => a.pageEntryId === entry.id)} meta={{ widthPt: heights[entry.id].widthPt, heightPt: heights[entry.id].heightPt, scale, rotation: ((heights[entry.id].pageRotate + entry.rotation) % 360) as 0 | 90 | 180 | 270 }} pageEl={() => document.getElementById(`page-${entry.id}`)} /> : null}
            {tool === "edit" && heights[entry.id] ? <BlockHint pageId={entry.id} scale={scale} heightPt={heights[entry.id].heightPt} register={registerHint} /> : null}
            {open && open.entry.id === entry.id && heights[entry.id] ? <BlockEditor key={open.blockKey} open={open} scale={scale} heightPt={heights[entry.id].heightPt} onClose={() => setOpen((o) => (o === open ? null : o))} /> : null}
            {openLines && openLines.entry.id === entry.id && heights[entry.id] ? <LineEditor key={[openLines.box.x, openLines.box.y, openLines.box.width, openLines.box.height].join(",")} open={openLines} scale={scale} heightPt={heights[entry.id].heightPt} onClose={() => setOpenLines((o) => (o === openLines ? null : o))} /> : null}
            <div className="page-label">{i + 1}</div>
            <OcrBadge sourceId={source.id} pageIndex={entry.sourcePageIndex} />
          </div>
        );
      })}
    </main>
  );
}
