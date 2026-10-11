import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { applyEditToOcr } from "../store/ocr";
import { measureFor } from "../pdf/metrics";
import { FONT_CSS } from "../pdf/fonts";
import { toWinAnsi } from "../pdf/winansi";
import { layoutBlock } from "../edit/layout";
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
  useEffect(() => {
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
    const clean = (ref.current ? readText(ref.current) : text).replace(/\s+$/g, "");
    if (clean === original || clean.trim() === "") { onClose(); return; }
    const l = layoutBlock(clean, block.box, block.fontSize, block.lineHeight, measure);
    const source = block.fontName === "ocr" || open.existing?.source === "ocr" ? "ocr" : "native";
    const edit = { pageEntryId: open.entry.id, boxes: l.boxes, text: clean, fontSize: block.fontSize, font, color: colors.text, background: colors.background, lineHeight: block.lineHeight, source, blockKey: open.blockKey } as const;
    const id = useDocumentStore.getState().addEdit(edit);
    if (source === "ocr") await applyEditToOcr(open.entry.sourceId, open.entry.sourcePageIndex, { ...edit, id }, measure);
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void apply(); }
  };
  const bad = toWinAnsi(text) !== text;
  return (
    <div className="block-editor-wrap" style={{ left: block.box.x * scale, top: (heightPt - block.box.y - block.box.height) * scale }}>
      <div ref={ref} data-testid="block-editor" className="block-editor" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
        style={{ width: block.box.width * scale, height: height * scale, background: rgb(colors.background), color: rgb(colors.text), font: FONT_CSS[font].replace("1px", `${block.fontSize * scale}px`), lineHeight: `${block.lineHeight * scale}px` }}
        onInput={(e) => setText(readText(e.currentTarget))} onKeyDown={onKey} onBlur={() => void apply()} />
      <div className="block-editor-bar">
        <span data-testid="block-hint">{lay.overflowLines > 0 ? `Overflows by ${lay.overflowLines} line(s)` : "Fits"}</span>
        {bad && <span className="block-warn">Some characters cannot be saved in this font</span>}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => void apply()}>Done</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
