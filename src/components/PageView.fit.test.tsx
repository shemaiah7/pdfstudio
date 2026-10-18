// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import PageView from "./PageView";
import { useDocumentStore } from "../store/document";
import { useToolsStore } from "../store/tools";
import { getPage } from "../pdf/render";
import { fitWidthScale } from "./fitScale";

vi.mock("../pdf/render", () => ({
  renderPage: vi.fn(() => ({ cancel: () => {}, promise: Promise.resolve() })),
  releaseSource: vi.fn(),
  getPage: vi.fn(),
}));
vi.mock("./PageCanvas", () => ({ default: () => <canvas /> }));
vi.mock("./TextLayer", () => ({ default: () => null }));
vi.mock("./useFields", () => ({ useFields: () => null }));
vi.mock("./ocr/OcrBadge", () => ({ default: () => null }));

const entry = { id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const };
const source = { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" };
const source2 = { ...source, id: "s2", name: "b.pdf" };
const entry2 = { id: "q0", sourceId: "s2", sourcePageIndex: 0, rotation: 0 as const };
const getPageMock = vi.mocked(getPage);
const page = (rotate: number) => ({ view: [0, 0, 612, 792], rotate }) as unknown as Awaited<ReturnType<typeof getPage>>;
let widthDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 680 });
  getPageMock.mockReset();
  getPageMock.mockResolvedValue(page(0));
  useDocumentStore.getState().reset();
  useDocumentStore.setState({ pages: [entry], sources: new Map([["s", source], ["s2", source2]]), edits: [] });
  useToolsStore.setState({ tool: "select", message: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (widthDesc) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDesc);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

describe("PageView fit width on open", () => {
  it("reports the scale that fits the first page into the pane", async () => {
    const spy = vi.fn();
    render(<PageView scale={1.2} onFitScale={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(1.03));
  });

  it("uses the rotated width for a sideways page", async () => {
    getPageMock.mockResolvedValue(page(90));
    const spy = vi.fn();
    render(<PageView scale={1.2} onFitScale={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(fitWidthScale(680, 792)));
    expect(fitWidthScale(680, 792)).toBe(0.8);
  });

  it("refits when a different file is opened first, but not when pages are appended", async () => {
    const spy = vi.fn();
    render(<PageView scale={1.2} onFitScale={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => { useDocumentStore.setState({ pages: [entry, entry2] }); });
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => { useDocumentStore.setState({ pages: [entry2] }); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("keeps the zoom when the first page is deleted or reordered within the same file", async () => {
    const spy = vi.fn();
    const second = { ...entry, id: "p1b" };
    useDocumentStore.setState({ pages: [entry, second] });
    render(<PageView scale={1.2} onFitScale={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => { useDocumentStore.setState({ pages: [second, entry] }); });
    await new Promise((r) => setTimeout(r, 20));
    act(() => { useDocumentStore.setState({ pages: [entry] }); });
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
