import { useEffect } from "react";
import { DEFAULT_STEPS, type DesktopOs } from "../pwa/defaultApp";
import { Icon } from "./icons";

interface Props { os: DesktopOs; onClose(): void }

export default function DefaultAppDialog({ os, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sigBackdrop" data-testid="default-app-dialog" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sigDialog installDialog" role="dialog" aria-label="Make SentinelPDF your default PDF app">
        <div className="sigHeader">
          <h2>Open PDFs with SentinelPDF</h2>
          <button type="button" className="sigClose" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="sigBody">
          <ol className="defaultSteps">{DEFAULT_STEPS[os].map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="installHelp">Your computer asks you to confirm this once — apps can't change it on their own.</p>
        </div>
        <div className="sigActions"><button type="button" className="sigPrimary" data-testid="default-app-done" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
