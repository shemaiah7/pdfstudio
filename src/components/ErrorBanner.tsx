import { useDocumentStore } from "../store/document";

export default function ErrorBanner() {
  const error = useDocumentStore((s) => s.error);
  const setError = useDocumentStore((s) => s.setError);
  if (!error) return null;
  return (
    <div className="banner" role="alert">
      <span>{error}</span>
      <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
