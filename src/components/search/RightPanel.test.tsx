// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RightPanel from "./RightPanel";
import { useSearchStore } from "../../store/search";
import { useLiveStore } from "../../store/live";
import { useAiStore } from "../../store/ai";

vi.mock("../../ai/turnstile", () => ({ getTurnstileToken: async () => "tok" }));
vi.mock("../../search/embedClient", () => ({ getEmbedClient: () => ({ load: async () => "wasm", embed: async () => new Float32Array(256), cancel() {}, dispose() {} }) }));
vi.mock("../../search/library", () => ({ library: { setModelTag() {}, loadAll: async () => [], list: async () => [], estimateUsage: async () => null, get: async () => undefined, remove: async () => {}, clear: async () => {}, persistent: true, lastWriteFailed: false }, sha256: async () => "h" }));

describe("RightPanel", () => {
  afterEach(cleanup);
  it("calls init on mount when search is enabled, without opening the Search tab", () => {
    const init = vi.fn(async () => {});
    useSearchStore.setState({ init, enabled: true, model: { status: "idle", loaded: 0, total: 0 } });
    render(<RightPanel />);
    expect(init).toHaveBeenCalledTimes(1);
  });
  it("calls init once even when not enabled (the store decides to no-op)", () => {
    const init = vi.fn(async () => {});
    useSearchStore.setState({ init, enabled: false, model: { status: "idle", loaded: 0, total: 0 } });
    render(<RightPanel />);
    expect(init).toHaveBeenCalledTimes(1);
  });
  it("has a Voice tab that shows the voice panel", () => {
    useSearchStore.setState({ init: async () => {} } as never);
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId("panel-tab-ai"));
    fireEvent.click(screen.getByTestId("panel-tab-voice"));
    expect(screen.getByTestId("voice-start")).toBeTruthy();
  });
  it("shows the Voice tab first and creates the AI client", () => {
    useSearchStore.setState({ init: async () => {} } as never);
    useAiStore.setState({ client: null });
    render(<RightPanel />);
    expect(screen.getByTestId("voice-start")).toBeTruthy();
    expect(useAiStore.getState().client).not.toBeNull();
  });
  it("shows an open-mic indicator on the Voice tab only while connecting or live", () => {
    useSearchStore.setState({ init: async () => {} } as never);
    useLiveStore.setState({ status: "live" });
    render(<RightPanel />);
    expect(screen.getByTestId("voice-tab-live")).toBeTruthy();
    cleanup();
    useLiveStore.setState({ status: "idle" });
    render(<RightPanel />);
    expect(screen.queryByTestId("voice-tab-live")).toBeNull();
  });
  it("assistant sheet handle toggles peek and open; tabs open it; Escape collapses", () => {
    useSearchStore.setState({ init: async () => {} } as never);
    const { container } = render(<RightPanel />);
    const panel = container.querySelector("aside.rightpanel")!;
    expect(panel.classList.contains("sheet-peek")).toBe(true);
    fireEvent.click(screen.getByLabelText("Expand assistant"));
    expect(panel.classList.contains("sheet-open")).toBe(true);
    const collapse = screen.getByLabelText("Collapse assistant");
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    expect(panel.classList.contains("sheet-peek")).toBe(true);
    fireEvent.click(screen.getByTestId("panel-tab-ai"));
    expect(panel.classList.contains("sheet-open")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel.classList.contains("sheet-peek")).toBe(true);
  });
});
