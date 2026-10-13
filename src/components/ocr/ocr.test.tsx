// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import OcrBadge from "./OcrBadge";
import OcrPill from "./OcrPill";
import DeepOcrMenu from "./DeepOcrMenu";
import { useOcrStore } from "../../store/ocr";
import { useDocumentStore } from "../../store/document";
import { useAiStore } from "../../store/ai";
import { currentPageId } from "../pageInView";

vi.mock("../pageInView", () => ({ currentPageId: vi.fn(() => null) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.mocked(currentPageId).mockReturnValue(null);
  useOcrStore.setState({ pages: {}, engineStatus: "idle", deepOcrAcknowledged: false, toast: null });
  useDocumentStore.setState({ sources: new Map([["s", { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 2, hash: "h" }]]), pages: [{ id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }, { id: "p1", sourceId: "s", sourcePageIndex: 1, rotation: 0 }], selection: new Set(["p1"]) });
});

describe("OcrBadge", () => {
  it("renders nothing for pages without OCR state and the right label otherwise", () => {
    const { container, rerender } = render(<OcrBadge sourceId="s" pageIndex={0} />);
    expect(container.textContent).toBe("");
    useOcrStore.setState({ pages: { "s:0": { state: "running", engine: "tesseract" } } });
    rerender(<OcrBadge sourceId="s" pageIndex={0} />);
    expect(screen.getByTestId("ocr-badge").textContent).toBe("Recognizing…");
    useOcrStore.setState({ pages: { "s:0": { state: "done", engine: "claude" } } });
    rerender(<OcrBadge sourceId="s" pageIndex={0} />);
    expect(screen.getByTestId("ocr-badge").textContent).toBe("Deep OCR");
    useOcrStore.setState({ pages: { "s:0": { state: "failed", engine: "tesseract", error: "x" } } });
    rerender(<OcrBadge sourceId="s" pageIndex={0} />);
    expect(screen.getByTestId("ocr-badge").textContent).toContain("Failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("OcrPill", () => {
  it("shows progress and cancel while recognizing", () => {
    useOcrStore.setState({ pages: { "s:0": { state: "done", engine: "tesseract" }, "s:1": { state: "queued", engine: "tesseract" } } });
    const cancel = vi.spyOn(useOcrStore.getState(), "cancelRecognition");
    render(<OcrPill />);
    expect(screen.getByTestId("ocr-pill").textContent).toContain("Recognizing text 1/2");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
  });
  it("shows the unavailable state with retry", () => {
    useOcrStore.setState({ engineStatus: "unavailable" });
    render(<OcrPill />);
    expect(screen.getByTestId("ocr-pill").textContent).toContain("Text recognition unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("DeepOcrMenu", () => {
  const setup = (over: Record<string, unknown> = {}) => {
    useAiStore.setState({ client: {} as never });
    const deep = vi.fn(async () => {});
    useOcrStore.setState({ deepOcr: deep, scannedPageEntries: () => ["p0", "p1"], pagesWithText: async () => [], ...over });
    return deep;
  };
  it("confirms once, then sends the selected pages", async () => {
    useOcrStore.setState({ pages: { "s:0": { state: "empty", engine: "tesseract" }, "s:1": { state: "done", engine: "tesseract" } } });
    const deep = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Selected pages" }));
    expect(confirm).toHaveBeenCalledWith("Deep OCR sends images of 1 page(s) to the AI service for transcription. Text stays on this device afterwards.");
    await waitFor(() => expect(deep).toHaveBeenCalledWith(["p1"], { allowText: false }));
    expect(useOcrStore.getState().deepOcrAcknowledged).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "All scanned pages" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(deep).toHaveBeenLastCalledWith("all-scanned", { allowText: false }));
  });
  it("is disabled without an AI client and explains why", () => {
    useAiStore.setState({ client: null });
    render(<DeepOcrMenu />);
    expect((screen.getByRole("button", { name: /^This page/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Deep OCR").closest("summary")?.getAttribute("title")).toBe("Deep OCR needs the AI service.");
  });
  it("This page targets the page in view and shows its number", async () => {
    vi.mocked(currentPageId).mockReturnValue("p0");
    useDocumentStore.setState({ selection: new Set() });
    const deep = setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    const btn = screen.getByRole("button", { name: /^This page/ });
    expect(btn.textContent).toBe("This page · p. 1");
    fireEvent.click(btn);
    await waitFor(() => expect(deep).toHaveBeenCalledWith(["p0"], { allowText: false }));
  });
  it("This page uses the single selected page over the page in view", async () => {
    vi.mocked(currentPageId).mockReturnValue("p0");
    const deep = setup(); // p1 is selected
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    const btn = screen.getByRole("button", { name: /^This page/ });
    expect(btn.textContent).toBe("This page · p. 2");
    fireEvent.click(btn);
    await waitFor(() => expect(deep).toHaveBeenCalledWith(["p1"], { allowText: false }));
  });
  it("This page works on a page that is not scanned", async () => {
    vi.mocked(currentPageId).mockReturnValue("p0");
    useDocumentStore.setState({ selection: new Set() });
    const deep = setup({ scannedPageEntries: () => [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    const btn = screen.getByRole("button", { name: /^This page/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(deep).toHaveBeenCalled());
  });
  it("says so when there is no page to read", async () => {
    vi.mocked(currentPageId).mockReturnValue(null);
    useDocumentStore.setState({ selection: new Set() });
    const deep = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    fireEvent.click(screen.getByRole("button", { name: "This page" }));
    expect(useOcrStore.getState().toast).toBe("No page to read.");
    expect(deep).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it("asks before sending a page that already has typed text", async () => {
    vi.mocked(currentPageId).mockReturnValue("p1");
    useDocumentStore.setState({ selection: new Set() });
    const deep = setup({ pagesWithText: async () => ["p1"] });
    useOcrStore.setState({ deepOcrAcknowledged: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    fireEvent.click(screen.getByRole("button", { name: /^This page/ }));
    await waitFor(() => expect(deep).toHaveBeenCalledWith(["p1"], { allowText: true }));
    expect(confirm).toHaveBeenCalledWith("Page 2 already has typed text. Send an image of it to read handwriting too?");
  });
  it("uses the plural wording and does not allow text when declined", async () => {
    useDocumentStore.setState({ selection: new Set(["p0", "p1"]) });
    const deep = setup({ pagesWithText: async () => ["p0", "p1"] });
    useOcrStore.setState({ deepOcrAcknowledged: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DeepOcrMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Selected pages" }));
    await waitFor(() => expect(deep).toHaveBeenCalledWith(["p0", "p1"], { allowText: false }));
    expect(confirm).toHaveBeenCalledWith("Pages 1, 2 already have typed text. Send an image of them to read handwriting too?");
  });
});
