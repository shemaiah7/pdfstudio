// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import App from "../App";
import { useDocumentStore } from "../store/document";
import { loadFixture } from "../test/loadFixture";

vi.mock("../pdf/render", () => ({
  renderPage: vi.fn(() => ({ cancel: () => {}, promise: Promise.resolve() })),
  releaseSource: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  useDocumentStore.getState().reset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("App with all pages deleted", () => {
  it("keeps the toolbar with Undo enabled and Download disabled", async () => {
    const st = useDocumentStore.getState();
    await st.openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    act(() => { st.remove(useDocumentStore.getState().pages.map((p) => p.id)); });
    render(<App />);
    const undo = screen.getByTestId("undo") as HTMLButtonElement;
    const download = screen.getByTestId("download") as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(download.disabled).toBe(true);
  });
});
