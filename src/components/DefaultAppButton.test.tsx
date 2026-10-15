// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import DefaultAppButton from "./DefaultAppButton";
import { DEFAULT_STEPS } from "../pwa/defaultApp";
import { useInstallStore } from "../pwa/install";

const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const setUa = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); useInstallStore.setState({ installed: false }); });

describe("DefaultAppButton", () => {
  it("is hidden when not installed", () => {
    setUa(MAC_CHROME);
    const { container } = render(<DefaultAppButton />);
    expect(container.innerHTML).toBe("");
  });

  it("is hidden when os is unsupported", () => {
    setUa(LINUX);
    useInstallStore.setState({ installed: true });
    const { container } = render(<DefaultAppButton />);
    expect(container.innerHTML).toBe("");
  });

  it("opens the mac steps; Done and Escape close", () => {
    setUa(MAC_CHROME);
    useInstallStore.setState({ installed: true });
    render(<DefaultAppButton />);
    fireEvent.click(screen.getByTestId("default-app"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    for (const s of DEFAULT_STEPS.mac) expect(screen.getByText(s)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get the desktop app" }).getAttribute("href")).toBe("/download");
    expect(localStorage.getItem("pdfstudio.defaultPrompt")).toBe("1");
    fireEvent.click(screen.getByTestId("default-app-done"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("default-app"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is hidden in the desktop app", () => {
    (window as Window & { sentinelDesktop?: unknown }).sentinelDesktop = { version: "1", onOpenFile: () => () => {} };
    try {
      setUa(MAC_CHROME);
      useInstallStore.setState({ installed: true });
      const { container } = render(<DefaultAppButton />);
      expect(container.innerHTML).toBe("");
    } finally { delete (window as Window & { sentinelDesktop?: unknown }).sentinelDesktop; }
  });
});
