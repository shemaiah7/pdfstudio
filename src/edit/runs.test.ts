import { describe, it, expect } from "vitest";
import { runsFor, runsFromEdit, runsText, sameRuns } from "./runs";
import { linesFrom } from "./blocks";
import type { TextItemBox } from "../pdf/text";
import type { Edit } from "../pdf/types";

const it_ = (str: string, x: number, w: number, fontName: string, size = 10): TextItemBox => ({ str, x, y: 700, width: w, height: size, fontSize: size, fontName });
const page = { commonObjs: { has: (id: string) => id === "g_bold", get: (id: string) => (id === "g_bold" ? { name: "Arial-BoldMT", bold: true } : null) } };
const styles = { g_reg: { fontFamily: "sans-serif" }, g_bold: { fontFamily: "sans-serif" } };

describe("runsFor", () => {
  it("matches a face per run and carries size and colour", () => {
    const [line] = linesFrom([it_("Label", 10, 40, "g_bold"), it_(" value", 50, 40, "g_reg")]);
    const runs = runsFor(line, page, styles, [0, 0, 0]);
    expect(runs).toEqual([{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "value", font: "helvetica", fontSize: 10, color: [0, 0, 0] }]);
  });
  it("maps OCR items to one helvetica run", () => {
    const [line] = linesFrom([it_("scan", 10, 40, "ocr")]);
    expect(runsFor(line, page, styles, [0, 0, 0])).toEqual([{ text: "scan", font: "helvetica", fontSize: 10, color: [0, 0, 0] }]);
  });
});

describe("run helpers", () => {
  const runs = [{ text: "A", font: "helvetica-bold" as const, fontSize: 10, color: [0, 0, 0] as [number, number, number] }, { text: " b", font: "helvetica" as const, fontSize: 10, color: [0, 0, 0] as [number, number, number] }];
  it("joins run text", () => { expect(runsText(runs)).toBe("A b"); });
  it("compares runs by text, font, and size", () => {
    expect(sameRuns(runs, runs.map((r) => ({ ...r })))).toBe(true);
    expect(sameRuns(runs, [{ ...runs[0], text: "A!" }, runs[1]])).toBe(false);
    expect(sameRuns(runs, [{ ...runs[0], font: "helvetica" }, runs[1]])).toBe(false);
    expect(sameRuns(runs, [runs[0]])).toBe(false);
  });
  it("reads runs back from a line edit, or synthesises one from a legacy block edit", () => {
    const line: Edit = { id: "e", pageEntryId: "p", boxes: [], text: "A b", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0], kind: "line", runs };
    expect(runsFromEdit(line)).toEqual(runs);
    const legacy: Edit = { id: "f", pageEntryId: "p", boxes: [], text: "old", fontSize: 9, font: "times", color: [1, 0, 0] };
    expect(runsFromEdit(legacy)).toEqual([{ text: "old", font: "times", fontSize: 9, color: [1, 0, 0] }]);
  });
});
