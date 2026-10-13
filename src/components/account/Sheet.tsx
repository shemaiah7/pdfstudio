import { useEffect, useId, type ReactNode } from "react";
import { Icon } from "../icons";

interface Props { title: string; onClose?: () => void; children: ReactNode; className?: string }

/** Shared Quiet Desk dialog shell. Without `onClose` the dialog can't be dismissed (terms step). */
export default function Sheet({ title, onClose, children, className = "" }: Props) {
  const id = useId();
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sigBackdrop" onMouseDown={(e) => { if (onClose && e.target === e.currentTarget) onClose(); }}>
      <div className={`sigDialog acct-sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sigHeader">
          <h2 id={id}>{title}</h2>
          {onClose ? <button type="button" className="sigClose" aria-label="Close" onClick={onClose}><Icon name="close" /></button> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
