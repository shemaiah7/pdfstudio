// src/edit/openLines.test.ts
import { describe, it, expect } from "vitest";
import { openLinesIn } from "./openLines";
import { useDocumentStore } from "../store/document";
import type { TextItemBox } from "../pdf/text";

const items: TextItemBox[] = [
  { str: "Label ", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "b" }, { str: "value", x: 50, y: 700, width: 25, height: 10, fontSize: 10, fontName: "r" },
  { str: "Right", x: 300, y: 700, width: 30, height: 10, fontSize: 10, fontName: "r" },
  { str: "Second", x: 20, y: 686, width: 30, height: 10, fontSize: 10, fontName: "r" },
];
const page = { commonObjs: { has: (id: string) => id === "b", get: () => ({ name: "Arial-BoldMT", bold: true }) } };
const entry = { id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const };
const source = { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" };

describe("openLinesIn", () => {
  it("returns one open line per detected line inside the box, with runs", async () => {
    useDocumentStore.setState({ ...useDocumentStore.getState(), edits: [], pages: [entry] });
    const open = await openLinesIn({ items, page, styles: {} }, source, entry, { x: 10, y: 680, width: 100, height: 32 }, { background: [1, 1, 1], text: [0, 0, 0] });
    expect(open?.lines.map((l) => l.runs.map((r) => r.text))).toEqual([["Label ", "value"], ["Second"]]);
    expect(open?.lines[0].runs[0].font).toBe("helvetica-bold");
  });
  it("returns null when the box holds no lines", async () => {
    expect(await openLinesIn({ items, page, styles: {} }, source, entry, { x: 150, y: 680, width: 50, height: 32 }, { background: [1, 1, 1], text: [0, 0, 0] })).toBeNull();
  });
  it("includes an existing line edit overlapping the box as a reopenable line with its stored runs", async () => {
    const region = { x: 20, y: 697.5, width: 55, height: 12 };
    useDocumentStore.setState({ ...useDocumentStore.getState(), pages: [entry], edits: [{ id: "e", pageEntryId: "p0", kind: "line", x: 20, baseline: 700, region, boxes: [region], runs: [{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "VALUE", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Label VALUE", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0] }] });
    // Extraction already applied the edit: items for that line are the edit's runs.
    const edited: TextItemBox[] = [{ str: "Label ", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "helvetica-bold" }, { str: "VALUE", x: 50, y: 700, width: 25, height: 10, fontSize: 10, fontName: "helvetica" }, items[3]];
    const open = await openLinesIn({ items: edited, page, styles: {} }, source, entry, { x: 10, y: 680, width: 100, height: 32 }, { background: [1, 1, 1], text: [0, 0, 0] });
    expect(open?.lines[0].existing?.id).toBe("e");
    expect(open?.lines[0].runs.map((r) => r.text)).toEqual(["Label ", "VALUE"]);
  });
});
