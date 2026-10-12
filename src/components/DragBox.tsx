import { useRef, useState } from "react";
import type { Box } from "../pdf/types";

const CLICK_PX = 3;
type Pt = { x: number; y: number };

export function useDragBox(onSelect: (box: Box | null, click: Pt) => void, toPage: (clientX: number, clientY: number) => Pt) {
  const start = useRef<{ client: Pt; page: Pt } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const boxFrom = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      start.current = { client: { x: e.clientX, y: e.clientY }, page: toPage(e.clientX, e.clientY) };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s) return;
      if (Math.hypot(e.clientX - s.client.x, e.clientY - s.client.y) < CLICK_PX) return;
      setBox(boxFrom(s.page, toPage(e.clientX, e.clientY)));
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s) return;
      start.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const moved = Math.hypot(e.clientX - s.client.x, e.clientY - s.client.y) >= CLICK_PX;
      setBox(null);
      onSelect(moved ? boxFrom(s.page, toPage(e.clientX, e.clientY)) : null, s.page);
    },
  };
  return { handlers, box };
}

export default function DragBox({ box, scale, heightPt }: { box: Box | null; scale: number; heightPt: number }) {
  if (!box) return null;
  return <div className="drag-box" data-testid="drag-box" style={{ left: box.x * scale, top: (heightPt - box.y - box.height) * scale, width: box.width * scale, height: box.height * scale }} />;
}
