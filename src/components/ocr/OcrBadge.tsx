import { useOcrStore, pageKey } from "../../store/ocr";
const LABEL = { queued: "Recognizing…", running: "Recognizing…", done: "Text recognized", empty: "No text found", failed: "Failed" } as const;
export default function OcrBadge({ sourceId, pageIndex }: { sourceId: string; pageIndex: number }) {
  const st = useOcrStore((s) => s.pages[pageKey(sourceId, pageIndex)]);
  const retry = useOcrStore((s) => s.retryPage);
  if (!st) return null;
  const label = st.state === "done" && st.engine === "claude" ? "Deep OCR" : LABEL[st.state];
  return (
    <span className={`ocr-badge ocr-${st.state}`} data-testid="ocr-badge" title={st.error}>
      {label}{st.state === "failed" && <> · <button onClick={(e) => { e.stopPropagation(); retry(sourceId, pageIndex); }}>Retry</button></>}
    </span>
  );
}
