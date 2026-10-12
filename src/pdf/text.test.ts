import { describe, it, expect } from "vitest";
import { linesFromItems, hasAnyText, applyEdits, type TextItemBox } from "./text";
import type { Edit } from "./types";

const item = (str: string, x: number, y: number, w = 10) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });

describe("linesFromItems", () => {
  it("joins items on the same baseline in x order", () => {
    expect(linesFromItems([item("world", 60, 700), item("Hello", 10, 700)])).toBe("Hello world");
  });
  it("separates lines by baseline, top to bottom", () => {
    expect(linesFromItems([item("second", 10, 680), item("first", 10, 700)])).toBe("first\nsecond");
  });
  it("keeps two columns on the same baseline readable left to right without merging words", () => {
    const text = linesFromItems([item("Left", 10, 700, 30), item("col", 45, 700, 20), item("Right", 300, 700, 40), item("col", 345, 700, 20)]);
    expect(text).toBe("Left col Right col");
  });
  it("does not add a space when items touch", () => {
    expect(linesFromItems([item("Hel", 10, 700, 20), item("lo", 30, 700, 10)])).toBe("Hello");
  });
  it("ignores empty items and tolerates small baseline jitter", () => {
    expect(linesFromItems([item("a", 10, 700), item("", 20, 700), item("b", 25, 701)])).toBe("a b");
  });
});

describe("hasAnyText", () => {
  it("is false for whitespace-only pages", () => {
    expect(hasAnyText([{ text: " \n" }, { text: "" }])).toBe(false);
    expect(hasAnyText([{ text: "x" }])).toBe(true);
  });
});

describe("applyEdits with line edits", () => {
  it("replaces the covered items with one item per run, carrying each run's face", async () => {
    const items: TextItemBox[] = [
      { str: "Assigned Caregiver", x: 20, y: 700, width: 90, height: 10, fontSize: 10, fontName: "g_bold" },
      { str: "Rylee Lyons", x: 130, y: 700, width: 60, height: 10, fontSize: 10, fontName: "g_reg" },
      { str: "Other line", x: 20, y: 686, width: 60, height: 10, fontSize: 10, fontName: "g_reg" },
    ];
    const edit: Edit = { id: "e", pageEntryId: "p", kind: "line", x: 130, baseline: 700, region: { x: 130, y: 697.5, width: 60, height: 12 }, boxes: [{ x: 130, y: 697.5, width: 60, height: 12 }], runs: [{ text: "Jamie Lee", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Jamie Lee", fontSize: 10, font: "helvetica", color: [0, 0, 0] };
    const out = await applyEdits(items, [edit]);
    expect(out.map((i) => i.str)).toEqual(["Assigned Caregiver", "Other line", "Jamie Lee"]);
    expect(out[2]).toMatchObject({ x: 130, y: 700, fontName: "helvetica", fontSize: 10 });
  });
  it("an emptied line edit removes the covered text and adds nothing", async () => {
    const items: TextItemBox[] = [{ str: "gone", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "g" }];
    const edit: Edit = { id: "e", pageEntryId: "p", kind: "line", x: 20, baseline: 700, region: { x: 20, y: 697.5, width: 30, height: 12 }, boxes: [{ x: 20, y: 697.5, width: 30, height: 12 }], runs: [], text: "", fontSize: 10, font: "helvetica", color: [0, 0, 0] };
    expect(await applyEdits(items, [edit])).toEqual([]);
  });
});
