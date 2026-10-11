import { useEffect } from "react";
import { useSearchStore } from "../../store/search";

const mb = (n: number) => `${Math.max(1, Math.round(n / 1_048_576))} MB`;

export default function LibraryPanel() {
  const library = useSearchStore((s) => s.library);
  const usage = useSearchStore((s) => s.usage);
  const persistent = useSearchStore((s) => s.persistent);
  const refreshLibrary = useSearchStore((s) => s.refreshLibrary);
  const removeFromLibrary = useSearchStore((s) => s.removeFromLibrary);
  const clearLibrary = useSearchStore((s) => s.clearLibrary);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);
  return (
    <div className="library">
      <p className="muted">Documents are stored on this device only{usage !== null ? ` · ${mb(usage)} used` : ""}.{!persistent && " Documents won't be remembered on this device"}</p>
      {library.length === 0 && <p className="muted">No documents yet.</p>}
      {library.map((r) => (
        <div key={r.hash} className="library-row" data-testid="library-row">
          <div>
            <div>{r.name}</div>
            <div className="muted">{r.pageCount} pages · {mb(r.size)} · {new Date(r.addedAt).toLocaleDateString()} · {r.stale ? "needs re-index" : r.chunkCount === 0 ? "No searchable text" : `${r.chunkCount} passages`}</div>
          </div>
          <button data-testid="library-remove" onClick={() => void removeFromLibrary(r.hash)}>Remove</button>
        </div>
      ))}
      <button data-testid="library-clear" onClick={() => { if (window.confirm("Remove all stored documents, recognized text, the downloaded model and turn off search?")) void clearLibrary(); }}>Clear all</button>
    </div>
  );
}
