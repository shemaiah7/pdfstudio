import { useCallback, useRef, useState, type DragEvent } from "react";

import { Icon, type IconName } from "./icons";
import ThemeToggle from "./ThemeToggle";
import InstallButton from "./InstallButton";
import DefaultAppButton from "./DefaultAppButton";
import AccountEntry from "./account/AccountEntry";
import { clerkEnabled } from "../account/clerk";
import { paywallEnabled } from "../account/capabilities";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "highlight", title: "A full editor, no upload", text: "Mark up, sign, retype text, merge files. Your PDF stays on this device." },
  { icon: "page", title: "Every answer points to a page", text: "Tap a citation and the page scrolls into view with the passage lit up." },
  { icon: "deep-ocr", title: "Scans work too", text: "Scanned pages are read automatically so search and voice can use them." },
];

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
      {empty ? (
        <>
          <header className="empty-top">
            <div className="empty-brand"><img className="empty-brand-mark" src="/brand/mark-small.svg" alt="" width="30" height="30" />SentinelPDF</div>
            <div className="empty-top-right">
              <InstallButton className="install-pill" />
              <DefaultAppButton className="install-pill" />
              <ThemeToggle className="theme-toggle-ghost" />
              <span className="empty-privacy"><Icon name="lock" size={14} />Files never leave your browser.</span>
              {clerkEnabled() ? <AccountEntry className="empty-account" /> : null}
            </div>
          </header>
          <div className="empty-main">
            <div className="empty-copy">
              <h1>Edit your PDF. Then talk to it.</h1>
              <p className="empty-lede">Reorder pages, fill and sign forms, and change printed text, all in your browser. Then ask questions out loud and hear answers that cite the exact page.</p>
              <ul className="empty-features">
                {FEATURES.map((f) => (
                  <li key={f.title}>
                    <span className="empty-feature-icon"><Icon name={f.icon} size={18} /></span>
                    <div><div className="empty-feature-title">{f.title}</div><div className="empty-feature-text">{f.text}</div></div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="empty-side">
              <div className="empty-card">
                <div className="empty-drop dropzone-inner">
                  <div className="empty-pages" aria-hidden="true"><span /><span /></div>
                  <div className="empty-drop-title">Drop PDFs here</div>
                  <div className="empty-drop-sub">Several files are merged into one document</div>
                  <button onClick={() => input.current?.click()}>Choose files</button>
                  <input ref={input} type="file" accept="application/pdf" multiple hidden
                    onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                </div>
              </div>
              <div className="empty-voice">
                <span className="empty-voice-icon" aria-hidden="true"><Icon name="mic" size={20} /></span>
                <div>
                  <div className="empty-voice-title">Then just ask, out loud</div>
                  <p className="muted" data-testid="voice-hint">Open a document, then talk to it: ask questions by voice and hear answers cited to the page.</p>
                </div>
              </div>
              <p className="empty-limits">{paywallEnabled() ? "Free account: 7 days of everything, then 5 AI questions and 5 Voice minutes a day · Pro $29/mo" : "Free: 20 AI requests and 30 minutes of voice a day"}</p>
            </div>
          </div>
          <footer className="empty-footer">
            <span>© SentinelPDF · Melantech Innovations L.L.C.</span>
            <nav aria-label="Legal and downloads"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/download">Desktop app</a></nav>
          </footer>
        </>
      ) : (over || forceOver) ? (
        <div className="drop-card" aria-hidden="true">
          <span className="drop-card-icon"><Icon name="add-file" size={22} /></span>
          <div className="drop-card-title">Drop to add pages</div>
          <div className="drop-card-sub">They go after the last page. Nothing is uploaded.</div>
        </div>
      ) : null}
    </div>
  );
}
