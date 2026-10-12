// src/components/LineEditor.tsx
import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { measureFor } from "../pdf/metrics";
import { FONT_CSS } from "../pdf/fonts";
import type { Measure } from "../pdf/layout";
import type { EditFont, Run } from "../pdf/types";
import { runsText, sameRuns, type OpenLines } from "../edit/runs";
export type { OpenLines } from "../edit/runs";

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/** Spans with data-run carry the run index they were created from (style from the template); bare text left by the browser joins the preceding run, or starts one styled from `fallback`. */
export function readRuns(el: HTMLElement, template: Run[], fallback: Run): Run[] {
  const out: Run[] = [];
  el.childNodes.forEach((node) => {
    const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
    const i = node instanceof HTMLElement && node.dataset.run !== undefined ? Number(node.dataset.run) : -1;
    if (i >= 0 && template[i]) out.push({ ...template[i], text });
    else if (out.length) out[out.length - 1].text += text;
    else out.push({ ...fallback, text });
  });
  return out.filter((r) => r.text);
}

function widthOf(runs: Run[], measures: Partial<Record<EditFont, Measure>>): number {
  return runs.reduce((w, r) => w + (measures[r.font]?.(r.text, r.fontSize) ?? r.text.length * r.fontSize * 0.5), 0);
}

export default function LineEditor({ open, scale, heightPt, onClose }: { open: OpenLines; scale: number; heightPt: number; onClose(): void }) {
  const [measures, setMeasures] = useState<Partial<Record<EditFont, Measure>>>({});
  const [current, setCurrent] = useState<Run[][]>(open.lines.map((l) => l.runs.map((r) => ({ ...r }))));
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const finished = useRef(false);
  const fallbackFor = (l: OpenLines["lines"][number]): Run => l.runs[0] ?? { text: "", font: l.existing?.font ?? "helvetica", fontSize: l.line.fontSize, color: l.existing?.color ?? [0, 0, 0] };
  const templateFor = (l: OpenLines["lines"][number]): Run[] => (l.runs.length ? l.runs : [fallbackFor(l)]);
  const applyRef = useRef<() => void>(() => {});

  useEffect(() => {
    let on = true;
    const faces = [...new Set(open.lines.flatMap((l) => l.runs.map((r) => r.font)))];
    void Promise.all(faces.map(async (f) => [f, await measureFor(f)] as const)).then((pairs) => { if (on) setMeasures(Object.fromEntries(pairs)); });
    return () => { on = false; };
  }, [open]);
  useEffect(() => { refs.current[0]?.focus(); }, []);
  useEffect(() => {
    // Native listener: React's synthetic onBeforeInput has no inputType.
    const handler = (e: Event) => {
      const ev = e as InputEvent;
      if (ev.inputType === "insertFromPaste") { ev.preventDefault(); document.execCommand("insertText", false, ev.dataTransfer?.getData("text/plain") ?? ""); }
      else if (ev.inputType?.startsWith("format") || ev.inputType === "insertFromDrop") ev.preventDefault();
    };
    const els = refs.current.filter((el): el is HTMLDivElement => !!el);
    els.forEach((el) => el.addEventListener("beforeinput", handler));
    return () => els.forEach((el) => el.removeEventListener("beforeinput", handler));
  }, [open]);
  useEffect(() => {
    const onDown = (e: Event) => { if (!(e.target as Element | null)?.closest?.(".line-editor")) applyRef.current(); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  const finish = () => { if (finished.current) return false; finished.current = true; return true; };
  const cancel = () => { if (finish()) onClose(); };
  const apply = () => {
    if (!finish()) return;
    try {
      const { addEdit, updateEdit } = useDocumentStore.getState();
      open.lines.forEach((l, i) => {
        const el = refs.current[i];
        const runs = el ? readRuns(el, templateFor(l), fallbackFor(l)) : current[i];
        if (sameRuns(runs, l.runs)) return;
        const first = runs[0] ?? fallbackFor(l);
        if (l.existing) { updateEdit(l.existing.id, { runs, text: runsText(runs), fontSize: first.fontSize, font: first.font, color: first.color }); return; }
        const region = l.line.box;
        const base = { kind: "line" as const, x: l.line.x, baseline: l.line.baseline, region, boxes: [region], runs, text: runsText(runs), fontSize: first.fontSize, font: first.font, color: first.color, background: l.background ?? open.background, source: (l.line.fontName === "ocr" ? "ocr" : "native") as "ocr" | "native" };
        addEdit({ pageEntryId: open.entry.id, ...base });
      });
    } catch (err) {
      console.error("Could not apply edits", err);
    } finally { onClose(); }
  };
  applyRef.current = apply;
  const remove = () => {
    if (!finish()) return;
    try { const { removeEdit } = useDocumentStore.getState(); open.lines.forEach((l) => { if (l.existing) removeEdit(l.existing.id); }); }
    catch (err) { console.error("Could not delete edit", err); }
    finally { onClose(); }
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Tab") { e.preventDefault(); refs.current[i + (e.shiftKey ? -1 : 1)]?.focus(); }
  };
  const onInput = (i: number) => { const el = refs.current[i]; if (el) setCurrent((c) => c.map((r, k) => (k === i ? readRuns(el, templateFor(open.lines[i]), fallbackFor(open.lines[i])) : r))); };
  const right = open.box.x + open.box.width;

  return (
    <div className="line-editor" data-testid="line-editor">
      {open.lines.map((l, i) => {
        const overflow = widthOf(current[i], measures) > right - l.line.x + 0.5;
        const width = Math.max(l.line.width, right - l.line.x);
        return (
          <div key={i} className="line-field-wrap" style={{ left: l.line.x * scale, top: (heightPt - l.line.baseline - l.line.fontSize) * scale, width: width * scale }}>
            <div ref={(el) => { refs.current[i] = el; }} data-testid="line-field" data-line-index={i} className={`line-field ${overflow ? "overflow" : ""}`} contentEditable suppressContentEditableWarning spellCheck={false}
              style={{ background: rgb(l.background ?? open.background), lineHeight: 1 }}
              onInput={() => onInput(i)} onKeyDown={(e) => onKey(e, i)}>
              {templateFor(l).map((r, k) => <span key={k} data-run={k} style={{ font: FONT_CSS[r.font].replace("1px", `${r.fontSize * scale}px`), color: rgb(r.color) }}>{l.runs.length ? r.text : ""}</span>)}
            </div>
            {overflow && <span className="line-overflow" data-testid="line-overflow">Text wider than the box</span>}
          </div>
        );
      })}
      <div className="line-editor-bar float-bar" style={{ left: open.box.x * scale, top: (heightPt - open.box.y) * scale + 4 }}>
        <button className="fb-btn primary" data-testid="line-done" onMouseDown={(e) => e.preventDefault()} onClick={apply}>Done</button>
        {open.lines.some((l) => l.existing) && <button className="fb-btn danger" data-testid="line-delete" onMouseDown={(e) => e.preventDefault()} onClick={remove}>Delete</button>}
        <button className="fb-btn" data-testid="line-cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
