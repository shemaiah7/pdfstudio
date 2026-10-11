// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import BlockEditor from "./BlockEditor";
import { useDocumentStore } from "../store/document";
import type { OpenBlock } from "../edit/pageBlocks";

vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const block = { lines: [], box: { x: 10, y: 100, width: 100, height: 12 }, lineHeight: 12, fontSize: 10, fontName: "f1", text: "Dose 10 mg", firstLineIndex: 0 };
const open = (over: Partial<OpenBlock> = {}): OpenBlock => ({
  entry: { id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }, source: { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1 },
  block, font: "helvetica", colors: { background: [1, 1, 1], text: [0, 0, 0] }, blockKey: "s:0:0", caretOffset: 0, ...over,
});

beforeEach(() => { cleanup(); useDocumentStore.setState({ edits: [], pages: [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }], past: [], future: [] }); });

describe("BlockEditor", () => {
  it("opens pre-filled once the measurer is ready and applies on Enter", async () => {
    const onClose = vi.fn();
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={onClose} />);
    const box = await screen.findByTestId("block-editor");
    expect(box.textContent).toBe("Dose 10 mg");
    box.textContent = "Dose 20 mg";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useDocumentStore.getState().edits).toHaveLength(1));
    expect(useDocumentStore.getState().edits[0]).toMatchObject({ text: "Dose 20 mg", font: "helvetica", blockKey: "s:0:0", source: "native", lineHeight: 12, background: [1, 1, 1] });
    expect(onClose).toHaveBeenCalled();
  });
  it("cancels on Escape and creates nothing when the text is unchanged", async () => {
    const onClose = vi.fn();
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={onClose} />);
    const box = await screen.findByTestId("block-editor");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(useDocumentStore.getState().edits).toHaveLength(0);
    cleanup();
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box2 = await screen.findByTestId("block-editor");
    fireEvent.keyDown(box2, { key: "Enter" });
    expect(useDocumentStore.getState().edits).toHaveLength(0);
  });
  it("shows the overflow hint and grows when the text no longer fits", async () => {
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box = await screen.findByTestId("block-editor");
    box.textContent = "a\nb\nc";
    fireEvent.input(box);
    expect(screen.getByTestId("block-hint").textContent).toBe("Overflows by 2 line(s)");
    expect(parseFloat(box.style.height)).toBeCloseTo(36);
  });
  it("reopens an existing edit with its text and replaces it", async () => {
    useDocumentStore.setState({ edits: [{ id: "ed-1", pageEntryId: "p", boxes: [block.box], text: "Old", fontSize: 10, font: "times", color: [0, 0, 0], blockKey: "s:0:0" }] });
    render(<BlockEditor open={open({ existing: useDocumentStore.getState().edits[0], font: "times" })} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box = await screen.findByTestId("block-editor");
    expect(box.textContent).toBe("Old");
    box.textContent = "New"; fireEvent.input(box); fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useDocumentStore.getState().edits[0].text).toBe("New"));
    expect(useDocumentStore.getState().edits).toHaveLength(1);
  });
  it("warns about characters outside WinAnsi", async () => {
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box = await screen.findByTestId("block-editor");
    box.textContent = "温度"; fireEvent.input(box);
    expect(screen.getByText("Some characters cannot be saved in this font")).toBeTruthy();
  });
});
