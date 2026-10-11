// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditHandles from "./EditHandles";
import { useDocumentStore } from "../store/document";
vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const edit = { id: "ed-1", pageEntryId: "p", boxes: [{ x: 10, y: 100, width: 100, height: 12 }], text: "Dose 10 mg", fontSize: 10, font: "helvetica" as const, color: [0, 0, 0] as [number, number, number], lineHeight: 12 };
beforeEach(() => { cleanup(); useDocumentStore.setState({ edits: [edit], past: [], future: [], pages: [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] }); });

describe("EditHandles", () => {
  it("deletes, changes the font, and reopens", () => {
    const onReopen = vi.fn();
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={onReopen} />);
    fireEvent.change(screen.getByTestId("edit-font"), { target: { value: "courier-bold" } });
    expect(useDocumentStore.getState().edits[0].font).toBe("courier-bold");
    fireEvent.click(screen.getByTestId("edit-body"));
    expect(onReopen).toHaveBeenCalledWith(expect.objectContaining({ id: "ed-1" }));
    fireEvent.click(screen.getByTestId("edit-delete"));
    expect(useDocumentStore.getState().edits).toHaveLength(0);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().edits).toHaveLength(1);
  });
  it("drags to move and re-lays out on width change", async () => {
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={vi.fn()} />);
    const drag = screen.getByTestId("edit-drag");
    fireEvent.pointerDown(drag, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(drag, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(drag, { clientX: 20, clientY: 10 });
    expect(useDocumentStore.getState().edits[0].boxes[0]).toMatchObject({ x: 30, y: 90 });
    const w = screen.getByTestId("edit-width");
    fireEvent.pointerDown(w, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(w, { clientX: -60, clientY: 0 });
    fireEvent.pointerUp(w, { clientX: -60, clientY: 0 });
    await screen.findByTestId("edit-drag");
    const boxes = useDocumentStore.getState().edits[0].boxes;
    expect(boxes[0].width).toBeCloseTo(40);
    expect(boxes.length).toBeGreaterThan(1); // "Dose 10 mg" no longer fits one 40pt line at 5pt/char
  });
});
