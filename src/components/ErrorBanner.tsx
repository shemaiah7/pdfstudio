import { useDocumentStore } from "../store/document";

export default function ErrorBanner() {
  const error = useDocumentStore((s) => s.error);
  const action = useDocumentStore((s) => s.errorAction);
  const setError = useDocumentStore((s) => s.setError);
  if (!error) return null;
  return (
    <div className="banner" role="alert">
      <span>{error}</span>
      {action ? <button className="banner-action" onClick={() => action.run()}>{action.label}</button> : null}
      <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
