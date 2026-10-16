import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { measureFor } from "../pdf/metrics";
import { FONT_CSS } from "../pdf/fonts";
import { toWinAnsi } from "../pdf/winansi";
import { layoutBlock, coverBoxes, placeEdit } from "../edit/layout";
import type { Measure } from "../pdf/layout";
import type { OpenBlock } from "../edit/pageBlocks";

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
// innerText keeps line breaks from the contentEditable; textContent covers environments without it (jsdom).
const readText = (el: HTMLElement) => (el.innerText ?? el.textContent ?? "").replace(/ /g, " ");

export default function BlockEditor({ open, scale, heightPt, onClose }: { open: OpenBlock; scale: number; heightPt: number; onClose(): void }) {
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [text, setText] = useState(open.existing?.text ?? open.block.text);
  const ref = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const original = open.existing?.text ?? open.block.text;
  useEffect(() => { let on = true; void measureFor(open.font).then((m) => { if (on) setMeasure(() => m); }); return () => { on = false; }; }, [open.font]);
  // Layout effect: fill the box in the same commit that first shows it, so nothing can see (or type into) an empty editor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!measure || !el) return;
    el.textContent = text;
    el.focus();
    const node = el.firstChild;
    if (node) { const r = document.createRange(); r.setStart(node, Math.min(open.caretOffset, node.textContent?.length ?? 0)); r.collapse(true); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
  }, [measure]); // eslint-disable-line react-hooks/exhaustive-deps -- set once when ready
  if (!measure) return null;
  const { block, font, colors } = open;
  const lay = layoutBlock(text, block.box, block.fontSize, block.lineHeight, measure);
  const height = Math.max(block.box.height, lay.height);
  const finish = () => { if (finished.current) return false; finished.current = true; return true; };
  const cancel = () => { if (finish()) onClose(); };
  const apply = async () => {
    if (!finish()) return;
    try {
      const clean = (ref.current ? readText(ref.current) : text).replace(/\s+$/g, "");
      if (clean === original || clean.trim() === "") return;
      const { addEdit, updateEdit } = useDocumentStore.getState();
      const existing = open.existing;
      if (existing) {
        // Reopened edit: update in place. `region` stays the original block; `block.box` is the (possibly moved) text frame.
        const region = existing.region ?? block.box;
        updateEdit(existing.id, { text: clean, region, boxes: placeEdit({ ...existing, text: clean, region }, measure).boxes });
        return;
      }
      const l = layoutBlock(clean, block.box, block.fontSize, block.lineHeight, measure);
      const source = block.fontName === "ocr" ? "ocr" : "native";
      addEdit({ pageEntryId: open.entry.id, boxes: coverBoxes(l, block.box), region: block.box, text: clean, fontSize: block.fontSize, font, color: colors.text, background: colors.background, lineHeight: block.lineHeight, source, blockKey: open.blockKey });
    } catch (err) {
      console.error("Could not apply edit", err);
    } finally {
      onClose(); // the editor always closes, even if the store update throws
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void apply(); }
  };
  const bad = toWinAnsi(text) !== text;
  return (
    <div className={`block-editor-wrap${lay.overflowLines > 0 ? " overflowing" : ""}`} style={{ left: block.box.x * scale, top: (heightPt - block.box.y - block.box.height) * scale }}>
      <div ref={ref} data-testid="block-editor" className="block-editor" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
        style={{ width: block.box.width * scale, height: height * scale, background: rgb(colors.background), color: rgb(colors.text), font: FONT_CSS[font].replace("1px", `${block.fontSize * scale}px`), lineHeight: `${block.lineHeight * scale}px` }}
        onInput={(e) => setText(readText(e.currentTarget))} onKeyDown={onKey} onBlur={() => void apply()} />
      <div className="block-editor-bar float-bar">
        <div className="fb-row">
          <span data-testid="block-hint" className={`block-hint ${lay.overflowLines > 0 ? "over" : "ok"}`}>{lay.overflowLines > 0 ? `Overflows by ${lay.overflowLines} line(s)` : "Fits"}</span>
          <span className="fb-sep" />
          <button className="fb-btn" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
          <button className="fb-btn primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void apply()}>Done</button>
        </div>
        {bad && <span className="block-warn">Some characters cannot be saved in this font</span>}
      </div>
    </div>
  );
}
