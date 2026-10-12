// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import PageView from "./PageView";
import { useDocumentStore } from "../store/document";
import { useToolsStore } from "../store/tools";
import type { Edit } from "../pdf/types";

vi.mock("../pdf/render", () => ({
  renderPage: vi.fn(() => ({ cancel: () => {}, promise: Promise.resolve() })),
  releaseSource: vi.fn(),
  getPage: vi.fn(),
}));
vi.mock("./PageCanvas", async () => {
  const React = await import("react");
  return { default: function MockPageCanvas({ onMeta }: { onMeta?: (m: { widthPt: number; heightPt: number; pageRotate: number }) => void }) {
    React.useEffect(() => { onMeta?.({ widthPt: 600, heightPt: 800, pageRotate: 0 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <canvas />;
  } };
});
vi.mock("./TextLayer", () => ({ default: () => null }));
vi.mock("./useFields", () => ({ useFields: () => null }));
vi.mock("./ocr/OcrBadge", () => ({ default: () => null }));
vi.mock("../edit/pageBlocks", async (orig) => {
  const actual = await orig<typeof import("../edit/pageBlocks")>();
  const { linesFrom: lf } = await import("../edit/blocks");
  const items = [
    { str: "Hello world", x: 100, y: 700, width: 100, height: 12, fontSize: 12, fontName: "f" },
    { str: "Second", x: 100, y: 680, width: 60, height: 12, fontSize: 12, fontName: "f" },
  ];
  return { ...actual, pageBlocks: vi.fn(async () => ({ lines: lf(items), items, styles: {}, page: { commonObjs: { has: () => false, get: () => null } }, blocks: [] })) };
});

const entry = { id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const };
const source = { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" };

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  useDocumentStore.getState().reset();
  useDocumentStore.setState({ pages: [entry], sources: new Map([["s", source]]), edits: [] });
  useToolsStore.setState({ tool: "edit", message: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  const view = render(<PageView scale={1} />);
  await waitFor(() => expect(view.container.querySelector(".edit-target-layer")).not.toBeNull());
  return view.container.querySelector<HTMLElement>(".edit-target-layer")!;
}
const down = (el: HTMLElement, x: number, y: number) => fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
const move = (el: HTMLElement, x: number, y: number) => fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
const up = (el: HTMLElement, x: number, y: number) => fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });

describe("PageView edit targeting", () => {
  it("a click on a line opens the line editor with one field", async () => {
    const layer = await mount();
    act(() => { down(layer, 120, 100); up(layer, 120, 100); });
    expect(await screen.findByTestId("line-editor")).toBeTruthy();
    expect(screen.getAllByTestId("line-field")).toHaveLength(1);
  });

  it("dragging a box shows it, then opens a field per line inside", async () => {
    const layer = await mount();
    act(() => { down(layer, 90, 90); move(layer, 150, 130); });
    expect(screen.getByTestId("drag-box")).toBeTruthy();
    act(() => { up(layer, 150, 130); });
    await screen.findByTestId("line-editor");
    expect(screen.getAllByTestId("line-field")).toHaveLength(2);
    expect(screen.queryByTestId("drag-box")).toBeNull();
  });

  it("a click on empty space reports no text", async () => {
    const layer = await mount();
    act(() => { down(layer, 400, 400); up(layer, 400, 400); });
    await waitFor(() => expect(useToolsStore.getState().message).toBe("No text here to edit"));
    expect(screen.queryByTestId("line-editor")).toBeNull();
  });

  it("a click on an existing line edit reopens it with its runs", async () => {
    const region = { x: 100, y: 697, width: 100, height: 14 };
    const edit = { id: "e", pageEntryId: "p0", kind: "line", x: 100, baseline: 700, region, boxes: [region], runs: [{ text: "EDITED", font: "helvetica", fontSize: 12, color: [0, 0, 0] }], text: "EDITED", fontSize: 12, font: "helvetica", color: [0, 0, 0] } as unknown as Edit;
    useDocumentStore.setState({ edits: [edit] });
    const layer = await mount();
    act(() => { down(layer, 120, 100); up(layer, 120, 100); });
    await screen.findByTestId("line-editor");
    const fields = screen.getAllByTestId("line-field");
    expect(fields).toHaveLength(1);
    expect(fields[0].textContent).toBe("EDITED");
  });

  it("a click on a legacy block edit selects it first and opens no editor", async () => {
    const box = { x: 100, y: 697, width: 100, height: 14 };
    const edit = { id: "L", pageEntryId: "p0", boxes: [box], text: "old", fontSize: 12, font: "helvetica", color: [0, 0, 0], background: [1, 1, 1], blockKey: "k" } as unknown as Edit;
    useDocumentStore.setState({ edits: [edit] });
    const layer = await mount();
    act(() => { down(layer, 120, 100); up(layer, 120, 100); });
    await screen.findByTestId("edit-drag");
    expect(screen.queryByTestId("line-editor")).toBeNull();
  });
});
