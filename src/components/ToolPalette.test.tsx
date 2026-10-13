// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ToolPalette from "./ToolPalette";
import { useToolsStore } from "../store/tools";
import { useAccount } from "../account/store";
import { useSheets } from "./account/useGate";
afterEach(() => { cleanup(); vi.unstubAllEnvs(); useAccount.setState({ me: null, loading: false }); useSheets.setState({ open: null }); });
beforeEach(() => { useToolsStore.setState({ tool: "select" }); });
describe("ToolPalette", () => {
  it("activates tools and Escape returns to select", () => {
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("tool-rect"));
    expect(useToolsStore.getState().tool).toBe("rect");
    expect(screen.getByTestId("tool-rect").className).toContain("active");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useToolsStore.getState().tool).toBe("select");
  });
  it("sets colour and width", () => {
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("color-blue"));
    fireEvent.click(screen.getByTestId("width-thick"));
    expect(useToolsStore.getState().color).toEqual([0.15, 0.39, 0.92]);
    expect(useToolsStore.getState().width).toBe(5);
  });
  it("with paywall on and plan free, choosing a draw tool opens the paywall instead of switching tool", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("tool-ink"));
    expect(useToolsStore.getState().tool).toBe("select");
    expect(useSheets.getState().open).toBe("paywall");
  });
  it("locked tools get the locked class and stay enabled; Select is never locked", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    render(<ToolPalette />);
    const ink = screen.getByTestId("tool-ink") as HTMLButtonElement;
    expect(ink.className).toContain("locked");
    expect(ink.disabled).toBe(false);
    expect(screen.getByTestId("tool-select").className).not.toContain("locked");
  });
  it("anonymous users get the upgrade sheet; the E shortcut is gated too", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    render(<ToolPalette />);
    fireEvent.keyDown(window, { key: "e" });
    expect(useToolsStore.getState().tool).toBe("select");
    expect(useSheets.getState().open).toBe("upgrade");
  });
  it("a trial user switches tools freely", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "trial", paywall: true } as never });
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("tool-ink"));
    expect(useToolsStore.getState().tool).toBe("ink");
    expect(screen.getByTestId("tool-ink").className).not.toContain("locked");
  });
  it("paywall off: tools switch as before", () => {
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("tool-ink"));
    expect(useToolsStore.getState().tool).toBe("ink");
    expect(screen.getByTestId("tool-ink").className).not.toContain("locked");
  });
});
