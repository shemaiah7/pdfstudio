// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RightPanel from "./RightPanel";
import { useSearchStore } from "../../store/search";
import { useLiveStore } from "../../store/live";

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
    fireEvent.click(screen.getByTestId("panel-tab-voice"));
    expect(screen.getByTestId("voice-start")).toBeTruthy();
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
});
