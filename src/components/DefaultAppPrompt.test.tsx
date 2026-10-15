// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import DefaultAppPrompt from "./DefaultAppPrompt";
import { DEFAULT_STEPS } from "../pwa/defaultApp";
import { useInstallStore } from "../pwa/install";

const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const KEY = "pdfstudio.defaultPrompt";

const setup = () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(WIN_EDGE);
  useInstallStore.setState({ installed: true });
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); useInstallStore.setState({ installed: false }); });

describe("DefaultAppPrompt", () => {
  it("shows when installed on windows and not done", () => {
    setup();
    render(<DefaultAppPrompt />);
    expect(screen.getByTestId("default-app-prompt").getAttribute("role")).toBe("status");
    expect(screen.getByText("Make SentinelPDF your default PDF app?")).toBeTruthy();
  });

  it("Not now hides and stores", () => {
    setup();
    render(<DefaultAppPrompt />);
    fireEvent.click(screen.getByTestId("default-app-dismiss"));
    expect(screen.queryByTestId("default-app-prompt")).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("Show me how opens windows steps and stores", () => {
    setup();
    render(<DefaultAppPrompt />);
    fireEvent.click(screen.getByTestId("default-app-show"));
    expect(screen.queryByTestId("default-app-prompt")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    for (const s of DEFAULT_STEPS.windows) expect(screen.getByText(s)).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("is not shown when already done, or not installed", () => {
    setup();
    localStorage.setItem(KEY, "1");
    const { container } = render(<DefaultAppPrompt />);
    expect(container.innerHTML).toBe("");
    cleanup();
    localStorage.clear();
    useInstallStore.setState({ installed: false });
    const r = render(<DefaultAppPrompt />);
    expect(r.container.innerHTML).toBe("");
  });

  it("is not shown in the desktop app", () => {
    (window as Window & { sentinelDesktop?: unknown }).sentinelDesktop = { version: "1", onOpenFile: () => () => {} };
    try {
      setup();
      const { container } = render(<DefaultAppPrompt />);
      expect(container.innerHTML).toBe("");
    } finally { delete (window as Window & { sentinelDesktop?: unknown }).sentinelDesktop; }
  });
});
