// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditHandles from "./EditHandles";
import { useDocumentStore } from "../store/document";
vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const edit = { id: "ed-1", pageEntryId: "p", boxes: [{ x: 10, y: 100, width: 100, height: 12 }], region: { x: 10, y: 100, width: 100, height: 12 }, text: "Dose 10 mg", fontSize: 10, font: "helvetica" as const, color: [0, 0, 0] as [number, number, number], lineHeight: 12 };
beforeEach(() => { cleanup(); useDocumentStore.setState({ edits: [edit], past: [], future: [], pages: [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] }); });

describe("EditHandles", () => {
  it("deletes, changes the font, and reopens", async () => {
    const onReopen = vi.fn();
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={onReopen} />);
    fireEvent.change(screen.getByTestId("edit-font"), { target: { value: "courier-bold" } });
    await vi.waitFor(() => expect(useDocumentStore.getState().edits[0].font).toBe("courier-bold"));
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
    fireEvent.pointerMove(drag, { clientX: 20, clientY: 10, buttons: 1 });
    fireEvent.pointerUp(drag, { clientX: 20, clientY: 10 });
    await vi.waitFor(() => expect(useDocumentStore.getState().edits[0].frame).toMatchObject({ x: 30, y: 90, width: 100 }));
    // Moving shifts only the text frame; the original region stays and is still covered.
    expect(useDocumentStore.getState().edits[0].region).toMatchObject({ x: 10, y: 100, width: 100 });
    const covers = useDocumentStore.getState().edits[0].boxes;
    expect(covers).toContainEqual({ x: 10, y: 100, width: 100, height: 12 });
    expect(covers.some((b) => b.x === 30 && b.y < 91)).toBe(true);
    const w = screen.getByTestId("edit-width");
    fireEvent.pointerDown(w, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(w, { clientX: -60, clientY: 0, buttons: 1 });
    fireEvent.pointerUp(w, { clientX: -60, clientY: 0 });
    await vi.waitFor(() => expect(useDocumentStore.getState().edits[0].frame).toMatchObject({ x: 30, y: 90, width: 40 }));
    const edit1 = useDocumentStore.getState().edits[0];
    expect(edit1.region).toMatchObject({ x: 10, y: 100, width: 100 });
    expect(edit1.boxes).toContainEqual(edit1.region);
    expect(edit1.boxes.length).toBeGreaterThan(2); // "Dose 10 mg" no longer fits one 40pt line at 5pt/char, plus the original region
  });
  it("covers the original region after a drag (union of covers contains it)", async () => {
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={vi.fn()} />);
    const drag = screen.getByTestId("edit-drag");
    fireEvent.pointerDown(drag, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(drag, { clientX: 300, clientY: -200, buttons: 1 });
    fireEvent.pointerUp(drag, { clientX: 300, clientY: -200 });
    await vi.waitFor(() => expect(useDocumentStore.getState().edits[0].frame).toBeDefined());
    const e = useDocumentStore.getState().edits[0];
    const r = e.region!;
    const covered = e.boxes.some((b) => b.x <= r.x && b.y <= r.y && b.x + b.width >= r.x + r.width && b.y + b.height >= r.y + r.height);
    expect(covered).toBe(true);
  });
  it("re-lays out on font change in one undo step", async () => {
    const wide = { ...edit, text: "Dose 10 mg twice daily", boxes: [{ x: 10, y: 100, width: 100, height: 12 }] };
    useDocumentStore.setState({ edits: [wide] });
    render(<EditHandles edit={wide} scale={1} heightPt={400} onReopen={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-font"), { target: { value: "courier-bold" } });
    await vi.waitFor(() => expect(useDocumentStore.getState().edits[0].font).toBe("courier-bold"));
    expect(useDocumentStore.getState().edits[0].boxes.length).toBeGreaterThan(1); // 22 chars * 5pt = 110 > 100
    expect(useDocumentStore.getState().past).toHaveLength(1);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().edits[0]).toMatchObject({ font: "helvetica" });
    expect(useDocumentStore.getState().edits[0].boxes).toHaveLength(1);
  });
  it("cancelled gesture commits nothing and ignores later moves", () => {
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={vi.fn()} />);
    const drag = screen.getByTestId("edit-drag");
    const frame = () => document.querySelector<HTMLElement>(".edit-handles")!.style.left;
    const before = frame();
    fireEvent.pointerDown(drag, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 20, clientY: 10, buttons: 1 });
    expect(frame()).not.toBe(before);
    fireEvent.pointerCancel(drag);
    expect(frame()).toBe(before);
    fireEvent.pointerMove(drag, { clientX: 50, clientY: 50, buttons: 1 });
    expect(frame()).toBe(before);
    expect(useDocumentStore.getState().past).toHaveLength(0);
    expect(useDocumentStore.getState().edits[0].boxes[0]).toMatchObject({ x: 10, y: 100 });
  });
  it("lets the latest font change win over a slower earlier one", async () => {
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-font"), { target: { value: "courier-bold" } });
    fireEvent.change(screen.getByTestId("edit-font"), { target: { value: "times" } });
    await vi.waitFor(() => expect(useDocumentStore.getState().edits[0].font).toBe("times"));
    await new Promise((r) => setTimeout(r, 20));
    expect(useDocumentStore.getState().edits[0].font).toBe("times");
  });
});
