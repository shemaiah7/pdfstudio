// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SearchTab from "./SearchTab";
import { useSearchStore } from "../../store/search";

vi.mock("../../search/embedClient", () => ({ getEmbedClient: () => ({ load: async () => "wasm", embed: async () => new Float32Array(256), cancel() {}, dispose() {} }) }));
vi.mock("../../search/library", () => ({ library: { setModelTag() {}, loadAll: async () => [], list: async () => [], estimateUsage: async () => null, get: async () => undefined, remove: async () => {}, clear: async () => {}, persistent: true, lastWriteFailed: false }, sha256: async () => "h" }));

const base = { persistent: true, lastWriteFailed: false, init: async () => {}, retryDoc: async () => {}, findSimilar: async () => {} };

describe("SearchTab", () => {
  afterEach(cleanup);
  it("shows the enable notice with the size and calls enable", () => {
    const enable = vi.fn(async () => {});
    useSearchStore.setState({ ...base, enabled: false, model: { status: "idle", loaded: 0, total: 0 }, enable });
    render(<SearchTab />);
    expect(screen.getByText(/200 MB/).textContent).toMatch(/stay on this device/);
    fireEvent.click(screen.getByTestId("search-enable"));
    expect(enable).toHaveBeenCalled();
  });
  it("shows download progress in MB", () => {
    useSearchStore.setState({ ...base, enabled: true, model: { status: "downloading", loaded: 52_428_800, total: 209_715_200 } });
    render(<SearchTab />);
    expect(screen.getByTestId("search-progress").textContent).toMatch(/50 MB of 200 MB/);
  });
  it("offers Retry when unavailable", () => {
    const retryModel = vi.fn(async () => {});
    useSearchStore.setState({ ...base, enabled: true, model: { status: "unavailable", loaded: 0, total: 0, error: "offline" }, retryModel });
    render(<SearchTab />);
    fireEvent.click(screen.getByText("Retry"));
    expect(retryModel).toHaveBeenCalled();
  });
  it("explains the missing WebGPU and offers explicit CPU mode", () => {
    const enableCpuMode = vi.fn(async () => {});
    useSearchStore.setState({ ...base, enabled: true, model: { status: "unavailable", loaded: 0, total: 0, error: "no-webgpu" }, enableCpuMode });
    render(<SearchTab />);
    expect(screen.getByText("Search needs WebGPU, which this browser doesn't provide.")).toBeTruthy();
    fireEvent.click(screen.getByText("Use CPU mode (downloads about 1 GB each visit)"));
    expect(enableCpuMode).toHaveBeenCalled();
  });
  it("renders results and opens a hit", () => {
    const openHit = vi.fn(async () => {});
    useSearchStore.setState({ ...base, enabled: true, model: { status: "ready", loaded: 0, total: 0, device: "wasm" }, results: [{ hash: "h", page: 2, chunkIndex: 0, score: 0.9, snippet: "warfarin held" }], library: [{ hash: "h", name: "note.pdf", size: 1, pageCount: 3, addedAt: 1, modelId: "m", chunkCount: 1, stale: false }], openHit, query: "warfarin" });
    render(<SearchTab />);
    const hit = screen.getByTestId("search-hit");
    expect(hit.textContent).toMatch(/note\.pdf/); expect(hit.textContent).toMatch(/p\. 3/); expect(hit.textContent).toMatch(/warfarin held/);
    fireEvent.click(hit);
    expect(openHit).toHaveBeenCalled();
  });
  it("says No matches for an empty result on a non-empty query, and notes slow devices on wasm", () => {
    useSearchStore.setState({ ...base, enabled: true, model: { status: "ready", loaded: 0, total: 0, device: "wasm" }, results: [], query: "warfarin", searching: false });
    render(<SearchTab />);
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.getByText(/Indexing will be slower on this device/)).toBeTruthy();
  });
  it("shows the persistence and write-failure notices", () => {
    useSearchStore.setState({ ...base, persistent: false, enabled: true, model: { status: "ready", loaded: 0, total: 0, device: "webgpu" }, results: [], query: "" });
    render(<SearchTab />);
    expect(screen.getByText("Documents won't be remembered on this device")).toBeTruthy();
    cleanup();
    useSearchStore.setState({ ...base, persistent: true, lastWriteFailed: true });
    render(<SearchTab />);
    expect(screen.getByText("One document could not be saved on this device")).toBeTruthy();
  });
  it("opens a hit with Enter, and Find similar with Enter does not open it", () => {
    const openHit = vi.fn(async () => {}); const findSimilar = vi.fn(async () => {});
    useSearchStore.setState({ ...base, findSimilar, enabled: true, model: { status: "ready", loaded: 0, total: 0, device: "webgpu" }, results: [{ hash: "h", page: 0, chunkIndex: 0, score: 0.9, snippet: "x" }], library: [], openHit, query: "x" });
    render(<SearchTab />);
    fireEvent.keyDown(screen.getByTestId("search-hit"), { key: "Enter" });
    expect(openHit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("search-similar"), { key: "Enter" });
    expect(openHit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("search-similar"));
    expect(findSimilar).toHaveBeenCalled();
    expect(openHit).toHaveBeenCalledTimes(1);
  });
});
