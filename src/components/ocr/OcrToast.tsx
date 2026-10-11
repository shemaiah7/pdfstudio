import { useOcrStore } from "../../store/ocr";
export default function OcrToast() {
  const toast = useOcrStore((s) => s.toast);
  const clear = useOcrStore((s) => s.clearToast);
  if (!toast) return null;
  return <div className="banner" role="status" data-testid="ocr-toast"><span>{toast}</span><button onClick={clear} aria-label="Dismiss">×</button></div>;
}
