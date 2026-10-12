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

/** Spans with data-run carry the run index they were created from; their text is the edited text, their style comes from the template. */
export function readRuns(el: HTMLElement, template: Run[]): Run[] {
  const out: Run[] = [];
  for (const span of el.querySelectorAll<HTMLElement>("[data-run]")) {
    const i = Number(span.dataset.run);
    const text = (span.textContent ?? "").replace(/ /g, " ");
    if (!text || !template[i]) continue;
    out.push({ ...template[i], text });
  }
  return out;
}

function widthOf(runs: Run[], measures: Partial<Record<EditFont, Measure>>): number {
  return runs.reduce((w, r) => w + (measures[r.font]?.(r.text, r.fontSize) ?? r.text.length * r.fontSize * 0.5), 0);
}

export default function LineEditor({ open, scale, heightPt, onClose }: { open: OpenLines; scale: number; heightPt: number; onClose(): void }) {
  const [measures, setMeasures] = useState<Partial<Record<EditFont, Measure>>>({});
  const [current, setCurrent] = useState<Run[][]>(open.lines.map((l) => l.runs.map((r) => ({ ...r }))));
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const finished = useRef(false);

  useEffect(() => {
    let on = true;
    const faces = [...new Set(open.lines.flatMap((l) => l.runs.map((r) => r.font)))];
    void Promise.all(faces.map(async (f) => [f, await measureFor(f)] as const)).then((pairs) => { if (on) setMeasures(Object.fromEntries(pairs)); });
    return () => { on = false; };
  }, [open]);
  useEffect(() => { refs.current[0]?.focus(); }, []);

  const finish = () => { if (finished.current) return false; finished.current = true; return true; };
  const cancel = () => { if (finish()) onClose(); };
  const apply = () => {
    if (!finish()) return;
    try {
      const { addEdit, updateEdit } = useDocumentStore.getState();
      open.lines.forEach((l, i) => {
        const el = refs.current[i];
        const runs = el ? readRuns(el, l.runs) : current[i];
        if (sameRuns(runs, l.runs)) return;
        const region = l.line.box;
        const first = runs[0] ?? l.runs[0];
        const base = { kind: "line" as const, x: l.line.x, baseline: l.line.baseline, region, boxes: [region], runs, text: runsText(runs), fontSize: first.fontSize, font: first.font, color: first.color, background: open.background, source: (l.line.fontName === "ocr" ? "ocr" : "native") as "ocr" | "native" };
        if (l.existing) updateEdit(l.existing.id, base); else addEdit({ pageEntryId: open.entry.id, ...base });
      });
    } catch (err) {
      console.error("Could not apply edits", err);
    } finally { onClose(); }
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Tab") { e.preventDefault(); refs.current[i + (e.shiftKey ? -1 : 1)]?.focus(); }
  };
  const onInput = (i: number) => { const el = refs.current[i]; if (el) setCurrent((c) => c.map((r, k) => (k === i ? readRuns(el, open.lines[i].runs) : r))); };
  const right = open.box.x + open.box.width;

  return (
    <div className="line-editor" data-testid="line-editor">
      {open.lines.map((l, i) => {
        const overflow = widthOf(current[i], measures) > right - l.line.x + 0.5;
        const width = Math.max(l.line.width, right - l.line.x);
        return (
          <div key={i} className="line-field-wrap" style={{ left: l.line.x * scale, top: (heightPt - l.line.baseline - l.line.fontSize) * scale, width: width * scale }}>
            <div ref={(el) => { refs.current[i] = el; }} data-testid="line-field" data-line-index={i} className={`line-field ${overflow ? "overflow" : ""}`} contentEditable suppressContentEditableWarning spellCheck={false}
              style={{ background: rgb(open.background), lineHeight: 1 }}
              onInput={() => onInput(i)} onKeyDown={(e) => onKey(e, i)}
              onBeforeInput={(e) => {
                // Keep typing inside the caret's run so the new text inherits its style; the browser's default does this for text nodes inside a span.
                const ev = e.nativeEvent as InputEvent;
                if (ev.inputType === "insertFromPaste") { e.preventDefault(); document.execCommand("insertText", false, ev.dataTransfer?.getData("text/plain") ?? ""); }
              }}>
              {l.runs.map((r, k) => <span key={k} data-run={k} style={{ font: FONT_CSS[r.font].replace("1px", `${r.fontSize * scale}px`), color: rgb(r.color) }}>{r.text}</span>)}
            </div>
            {overflow && <span className="line-overflow" data-testid="line-overflow">Text wider than the box</span>}
          </div>
        );
      })}
      <div className="line-editor-bar" style={{ left: open.box.x * scale, top: (heightPt - open.box.y) * scale + 4 }}>
        <button data-testid="line-done" onMouseDown={(e) => e.preventDefault()} onClick={apply}>Done</button>
        <button data-testid="line-cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
