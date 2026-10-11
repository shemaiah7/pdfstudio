import { useShallow } from "zustand/react/shallow";
import { useOcrStore } from "../../store/ocr";
export default function OcrPill() {
  const status = useOcrStore((s) => s.engineStatus);
  const progress = useOcrStore(useShallow((s) => { void s.pages; return s.progress(); }));
  const cancelRecognition = useOcrStore((s) => s.cancelRecognition);
  const retryEngine = useOcrStore((s) => s.retryEngine);
  if (status === "unavailable") return <span className="ocr-pill" data-testid="ocr-pill">Text recognition unavailable <button onClick={() => void retryEngine()}>Retry</button></span>;
  if (!progress) return null;
  return <span className="ocr-pill" data-testid="ocr-pill">Recognizing text {progress.done}/{progress.total} <button onClick={cancelRecognition}>Cancel</button></span>;
}
