import { useEffect, useRef, useState } from "react";

interface Props { left: number; top: number; text: string; onDone(text: string): void; onDelete(): void; onClose(): void }

export default function NotePopover({ left, top, text, onDone, onDelete, onClose }: Props) {
  const [value, setValue] = useState(text);
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, text, onDone, onClose });
  latest.current = { value, text, onDone, onClose };
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      const l = latest.current;
      if (l.value !== l.text) l.onDone(l.value); else l.onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return (
    <div ref={ref} className="notePopover" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Note text" />
      <div className="notePopoverActions">
        <button onClick={() => onDone(value)}>Done</button>
        <button onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
