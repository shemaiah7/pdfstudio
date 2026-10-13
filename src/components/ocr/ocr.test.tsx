// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import OcrBadge from "./OcrBadge";
import OcrPill from "./OcrPill";
import DeepOcrMenu from "./DeepOcrMenu";
import { useOcrStore } from "../../store/ocr";
import { useDocumentStore } from "../../store/document";
import { useAiStore } from "../../store/ai";
import { useAccount } from "../../account/store";
import { useSheets } from "../account/useGate";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); useAccount.setState({ me: null, loading: false }); useSheets.setState({ open: null }); });

beforeEach(() => {
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
  it("confirms once, then sends the selected pages", async () => {
    useOcrStore.setState({ pages: { "s:0": { state: "empty", engine: "tesseract" }, "s:1": { state: "done", engine: "tesseract" } } });
    useAiStore.setState({ client: {} as never });
    const deep = vi.fn(async () => {});
    useOcrStore.setState({ deepOcr: deep, scannedPageEntries: () => ["p0", "p1"] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Selected pages" }));
    expect(confirm).toHaveBeenCalledWith("Deep OCR sends images of 1 page(s) to the AI service for transcription. Text stays on this device afterwards.");
    expect(deep).toHaveBeenCalledWith(["p1"]);
    expect(useOcrStore.getState().deepOcrAcknowledged).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "All scanned pages" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deep).toHaveBeenLastCalledWith("all-scanned");
  });
  it("is disabled without an AI client", () => {
    useAiStore.setState({ client: null });
    render(<DeepOcrMenu />);
    expect((screen.getByRole("button", { name: "This page" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("free plan: Deep OCR opens the paywall and does not run", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    useAiStore.setState({ client: {} as never });
    const deep = vi.fn(async () => {});
    useOcrStore.setState({ deepOcr: deep, scannedPageEntries: () => ["p0", "p1"] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeepOcrMenu />);
    expect(screen.getByTestId("deep-ocr").querySelector("summary")!.className).toContain("locked");
    fireEvent.click(screen.getByRole("button", { name: "All scanned pages" }));
    expect(useSheets.getState().open).toBe("paywall");
    expect(confirm).not.toHaveBeenCalled();
    expect(deep).not.toHaveBeenCalled();
  });
});
