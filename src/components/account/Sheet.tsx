import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "../icons";

interface Props { title: string; onClose?: () => void; children: ReactNode; className?: string }

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Shared Quiet Desk dialog shell. Without `onClose` the dialog can't be dismissed (terms step). Focus moves in, stays in, and returns on close. */
export default function Sheet({ title, onClose, children, className = "" }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) { onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      if (items.length === 0) { e.preventDefault(); return; }
      const a = document.activeElement;
      if (e.shiftKey && (a === items[0] || a === ref.current)) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && a === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sigBackdrop" onMouseDown={(e) => { if (onClose && e.target === e.currentTarget) onClose(); }}>
      <div className={`sigDialog acct-sheet ${className}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sigHeader">
          <h2 id={id}>{title}</h2>
          {onClose ? <button type="button" className="sigClose" aria-label="Close" onClick={onClose}><Icon name="close" /></button> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
