import { create } from "zustand";
import type { RGB } from "../pdf/types";
export type Tool = "select" | "highlight" | "note" | "ink" | "rect" | "arrow" | "freetext" | "sign";
export const COLORS: { name: string; rgb: RGB }[] = [
  { name: "black", rgb: [0, 0, 0] }, { name: "red", rgb: [0.86, 0.15, 0.15] }, { name: "blue", rgb: [0.15, 0.39, 0.92] },
  { name: "green", rgb: [0.13, 0.63, 0.3] }, { name: "yellow", rgb: [1, 0.84, 0] }, { name: "purple", rgb: [0.55, 0.25, 0.8] },
];
export const WIDTHS = [{ name: "thin" as const, value: 1 }, { name: "medium" as const, value: 2.5 }, { name: "thick" as const, value: 5 }];
const same = (a: RGB, b: RGB) => a.every((v, i) => v === b[i]);
interface ToolsState { tool: Tool; color: RGB; width: number; pendingSignature: string | null; message: string | null; setMessage(m: string | null): void; setTool(t: Tool): void; setColor(c: RGB): void; setWidth(w: number): void; setPendingSignature(png: string | null): void }
export const useToolsStore = create<ToolsState>((set, get) => ({
  tool: "select", color: COLORS[1].rgb, width: 2.5, pendingSignature: null, message: null,
  setTool: (tool) => {
    const { color } = get();
    let next = color;
    if (tool === "highlight" && same(color, COLORS[1].rgb)) next = COLORS[4].rgb;
    if (tool !== "highlight" && tool !== "select" && same(color, COLORS[4].rgb)) next = COLORS[1].rgb;
    set({ tool, color: next, message: null, pendingSignature: tool === "sign" ? get().pendingSignature : null });
  },
  setMessage: (message) => set({ message }),
  setColor: (color) => set({ color }),
  setWidth: (width) => set({ width }),
  setPendingSignature: (pendingSignature) => set({ pendingSignature }),
}));
