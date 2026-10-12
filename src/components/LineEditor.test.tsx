// src/components/LineEditor.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import LineEditor, { readRuns, type OpenLines } from "./LineEditor";
import { useDocumentStore } from "../store/document";
import { linesFrom } from "../edit/blocks";
import type { Run } from "../pdf/types";

vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const bold: Run = { text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] };
const reg: Run = { text: "value", font: "helvetica", fontSize: 10, color: [0, 0, 0] };
function openLines(): OpenLines {
  const [line1] = linesFrom([{ str: "Label ", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "b" }, { str: "value", x: 50, y: 700, width: 25, height: 10, fontSize: 10, fontName: "r" }]);
  const [line2] = linesFrom([{ str: "Second", x: 20, y: 686, width: 30, height: 10, fontSize: 10, fontName: "r" }]);
  return { entry: { id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }, source: { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" }, box: { x: 15, y: 680, width: 100, height: 32 }, background: [1, 1, 1], lines: [{ line: line1, runs: [bold, reg] }, { line: line2, runs: [{ ...reg, text: "Second" }] }] };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => { useDocumentStore.setState({ ...useDocumentStore.getState(), edits: [], pages: [{ id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] }); });
afterEach(cleanup);

describe("readRuns", () => {
  it("reads spans back into runs and drops empty ones", () => {
    const el = document.createElement("div");
    el.innerHTML = '<span data-run="0">Label </span><span data-run="1"></span><span data-run="2">x</span>';
    expect(readRuns(el, [bold, reg, reg])).toEqual([{ ...bold }, { ...reg, text: "x" }]);
  });
});

describe("LineEditor", () => {
  it("renders one field per line with styled spans", async () => {
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const fields = screen.getAllByTestId("line-field");
    expect(fields).toHaveLength(2);
    const spans = fields[0].querySelectorAll("[data-run]");
    expect(spans).toHaveLength(2);
    expect((spans[0] as HTMLElement).style.font).toMatch(/bold|700/);
    expect(spans[1].textContent).toBe("value");
  });
  it("applies only changed lines, keeping the bold run", async () => {
    const onClose = vi.fn();
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={onClose} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "VALUE";
    fireEvent.input(field);
    fireEvent.click(screen.getByTestId("line-done"));
    await flush();
    const edits = useDocumentStore.getState().edits;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ kind: "line", x: 20, baseline: 700, runs: [bold, { ...reg, text: "VALUE" }], text: "Label VALUE", region: { x: 20, y: 697.5, width: 55, height: 12 } });
    expect(onClose).toHaveBeenCalled();
  });
  it("an emptied field becomes a white-out edit", async () => {
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[1];
    field.querySelector('[data-run="0"]')!.textContent = "";
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: "Enter" });
    await flush();
    expect(useDocumentStore.getState().edits[0]).toMatchObject({ kind: "line", runs: [], text: "" });
  });
  it("Escape applies nothing", async () => {
    const onClose = vi.fn();
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={onClose} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "changed";
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(useDocumentStore.getState().edits).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });
  it("shows the overflow note when the runs exceed the box", async () => {
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "a very long value that does not fit the drawn box";
    fireEvent.input(field);
    expect(screen.getByTestId("line-overflow").textContent).toBe("Text wider than the box");
  });
  it("updates a reopened edit in place", async () => {
    const open = openLines();
    const id = useDocumentStore.getState().addEdit({ pageEntryId: "p0", kind: "line", x: 20, baseline: 700, region: open.lines[0].line.box, boxes: [open.lines[0].line.box], runs: [bold, reg], text: "Label value", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0], background: [1, 1, 1] });
    open.lines[0].existing = useDocumentStore.getState().edits[0];
    render(<LineEditor open={open} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "again";
    fireEvent.input(field);
    fireEvent.click(screen.getByTestId("line-done"));
    await flush();
    const edits = useDocumentStore.getState().edits;
    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe(id);
    expect(edits[0].runs?.[1].text).toBe("again");
  });
});
