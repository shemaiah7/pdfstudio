import { useCallback, useRef, useState, type DragEvent } from "react";

interface Props { onFiles: (files: File[]) => void; empty: boolean; forceOver?: boolean }

export default function DropZone({ onFiles, empty, forceOver = false }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  }, [onFiles]);

  return (
    <div
      className={`dropzone ${over || forceOver ? "over" : ""} ${empty ? "empty" : "overlay"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handle}
    >
      {empty && (
        <div className="dropzone-inner">
          <h1>PDF Studio</h1>
          <p>Drop PDF files here, or</p>
          <button onClick={() => input.current?.click()}>Choose files</button>
          <input ref={input} type="file" accept="application/pdf" multiple hidden
            onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <p className="muted">Files never leave your browser.</p>
          <p className="muted" data-testid="voice-hint">Open a document, then talk to it: ask questions by voice and hear answers cited to the page.</p>
        </div>
      )}
    </div>
  );
}
