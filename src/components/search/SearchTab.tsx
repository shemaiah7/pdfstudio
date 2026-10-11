import { useState } from "react";
import { useSearchStore } from "../../store/search";
import { useDocumentStore } from "../../store/document";
import { useOcrStore } from "../../store/ocr";
import LibraryPanel from "./LibraryPanel";

const mb = (n: number) => `${Math.round(n / 1_048_576)} MB`;

export default function SearchTab() {
  const s = useSearchStore();
  const sources = useDocumentStore((d) => d.sources);
  const recognizing = useOcrStore((o) => o.textStatus()) === "recognizing";
  const [libraryOpen, setLibraryOpen] = useState(false);
  const isOpen = (hash: string) => Object.entries(s.hashBySource).some(([sid, h]) => h === hash && sources.has(sid));
  const nameOf = (hash: string) => s.library.find((r) => r.hash === hash)?.name ?? "document";

  if (!s.enabled || s.model.status === "idle") {
    return (
      <div className="ai-tab">
        <p className="muted">Search by meaning across the documents you open. Downloads a model of about 200 MB once; documents stay on this device.</p>
        <button data-testid="search-enable" className="primary" onClick={() => void s.enable()}>Enable search</button>
      </div>
    );
  }
  if (s.model.status === "downloading") {
    const pct = s.model.total ? Math.round((100 * s.model.loaded) / s.model.total) : 0;
    return (
      <div className="ai-tab">
        <div data-testid="search-progress">Downloading model: {mb(s.model.loaded)} of {s.model.total ? mb(s.model.total) : "about 200 MB"} ({pct}%)</div>
        <progress max={100} value={pct} />
      </div>
    );
  }
  if (s.model.status === "unavailable" && s.model.error === "no-webgpu") {
    return (
      <div className="ai-tab">
        <div className="ai-error">Search needs WebGPU, which this browser doesn't provide.</div>
        <button data-testid="search-cpu-mode" onClick={() => void s.enableCpuMode()}>Use CPU mode (downloads about 1 GB each visit)</button>
      </div>
    );
  }
  if (s.model.status === "unavailable") {
    return (
      <div className="ai-tab">
        <div className="ai-error">Couldn't load the search model{s.model.error ? `: ${s.model.error}` : ""}.</div>
        <button className="primary" onClick={() => void s.retryModel()}>Retry</button>
        <button data-testid="search-cpu-mode" onClick={() => void s.enableCpuMode()}>Use CPU mode (downloads about 1 GB each visit)</button>
      </div>
    );
  }
  return (
    <div className="ai-tab">
      {s.model.device === "wasm" && <p className="muted">Indexing will be slower on this device (no WebGPU), and the model is about 1 GB each visit.</p>}
      {!s.persistent && <p className="muted">Documents won't be remembered on this device</p>}
      {s.persistent && s.lastWriteFailed && <p className="muted">One document could not be saved on this device</p>}
      <div className="ai-row">
        <input data-testid="search-input" value={s.query} placeholder="Search by meaning" onChange={(e) => s.setQuery(e.target.value)} />
        <button data-testid="search-library-open" onClick={() => setLibraryOpen((o) => !o)}>Library</button>
      </div>
      <ul className="search-status">
        {[...sources.values()].map((src) => { const h = s.hashBySource[src.id]; const d = h ? s.docs[h] : undefined; return (
          <li key={src.id}>{src.name}: {!d ? "waiting" : d.status === "indexing" ? `${d.phase === "embed" ? "embedding" : d.phase === "extract" ? "reading" : "indexing"} ${d.done}/${d.total}` : d.status === "no-text" ? (recognizing ? "Recognizing text… try again in a moment." : "No text could be recognized. Try Deep OCR.") : d.status === "failed" ? <>failed <button onClick={() => void s.retryDoc(h)}>Retry</button></> : d.status}</li>
        ); })}
      </ul>
      {libraryOpen && <LibraryPanel />}
      <div className="search-results" data-testid="search-results">
        {s.searching && <p className="muted">Searching…</p>}
        {!s.searching && s.searchError && <p className="ai-error">Search failed. <button onClick={() => void s.search()}>Retry</button></p>}
        {!s.searching && !s.searchError && s.query.trim() && s.results.length === 0 && <p className="muted">No matches</p>}
        {s.results.map((h) => (
          <div key={`${h.hash}:${h.chunkIndex}`} className="search-hit" data-testid="search-hit" role="link" tabIndex={0} onClick={() => void s.openHit(h)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); void s.openHit(h); } }}>
            <div className="search-hit-head">{nameOf(h.hash)} · p. {h.page + 1}
              {!isOpen(h.hash) && <button data-testid="search-open" onClick={(e) => { e.stopPropagation(); void s.openHit(h); }} onKeyDown={(e) => e.stopPropagation()}>Open</button>}
              <button data-testid="search-similar" onClick={(e) => { e.stopPropagation(); void s.findSimilar(h.hash, h.chunkIndex); }} onKeyDown={(e) => e.stopPropagation()}>Find similar</button>
            </div>
            <div className="search-snippet">{h.snippet}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
