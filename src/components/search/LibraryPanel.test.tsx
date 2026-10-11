// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LibraryPanel from "./LibraryPanel";
import { useSearchStore } from "../../store/search";

vi.mock("../../search/embedClient", () => ({ getEmbedClient: () => ({ load: async () => "wasm", embed: async () => new Float32Array(256), cancel() {}, dispose() {} }) }));
vi.mock("../../search/library", () => ({ library: { setModelTag() {}, loadAll: async () => [], list: async () => [], estimateUsage: async () => null, get: async () => undefined, remove: async () => {}, clear: async () => {}, persistent: true, lastWriteFailed: false }, sha256: async () => "h" }));

describe("LibraryPanel", () => {
  afterEach(cleanup);
  it("lists documents with size and status and removes one", () => {
    const removeFromLibrary = vi.fn(async () => {});
    useSearchStore.setState({ refreshLibrary: async () => {}, removeFromLibrary, usage: 3_145_728, persistent: true, lastWriteFailed: false, library: [
      { hash: "a", name: "a.pdf", size: 2_097_152, pageCount: 4, addedAt: Date.UTC(2026, 9, 11), modelId: "m", chunkCount: 9, stale: false },
      { hash: "b", name: "scan.pdf", size: 1, pageCount: 1, addedAt: 1, modelId: "m", chunkCount: 0, stale: false },
    ] });
    render(<LibraryPanel />);
    const rows = screen.getAllByTestId("library-row");
    expect(rows[0].textContent).toMatch(/a\.pdf/); expect(rows[0].textContent).toMatch(/2 MB/); expect(rows[0].textContent).toMatch(/4 pages/);
    expect(rows[1].textContent).toMatch(/No searchable text/);
    expect(screen.getByText(/stored on this device only/).textContent).toMatch(/3 MB/);
    fireEvent.click(screen.getAllByTestId("library-remove")[0]);
    expect(removeFromLibrary).toHaveBeenCalledWith("a");
  });
  it("clear all asks for confirmation", () => {
    const clearLibrary = vi.fn(async () => {});
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    useSearchStore.setState({ refreshLibrary: async () => {}, clearLibrary, library: [] });
    const confirm = vi.spyOn(window, "confirm");
    render(<LibraryPanel />);
    fireEvent.click(screen.getByTestId("library-clear"));
    expect(confirm).toHaveBeenCalledWith("Remove all stored documents, recognized text, the downloaded model and turn off search?");
    expect(clearLibrary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("library-clear"));
    expect(clearLibrary).toHaveBeenCalled();
  });
});
