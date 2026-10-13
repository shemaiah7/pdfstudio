// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InstallButton from "./InstallButton";
import { useInstallStore } from "../pwa/install";

afterEach(() => { cleanup(); useInstallStore.setState({ canPrompt: false, installed: false, platformHint: "none" }); });

describe("InstallButton", () => {
  it("renders nothing when installed or no hint", () => {
    useInstallStore.setState({ installed: true, platformHint: "prompt" });
    const { container, rerender } = render(<InstallButton />);
    expect(container.innerHTML).toBe("");
    useInstallStore.setState({ installed: false, platformHint: "none" });
    rerender(<InstallButton />);
    expect(container.innerHTML).toBe("");
  });

  it("prompt hint calls install()", () => {
    const install = vi.fn(async () => {});
    useInstallStore.setState({ platformHint: "prompt", canPrompt: true, install });
    render(<InstallButton />);
    fireEvent.click(screen.getByTestId("install-app"));
    expect(install).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("iOS opens the Share instructions; Escape closes", () => {
    useInstallStore.setState({ platformHint: "ios" });
    render(<InstallButton />);
    fireEvent.click(screen.getByTestId("install-app"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Tap the Share button, then Add to Home Screen.")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Mac Safari shows the Add to Dock text; scrim click closes", () => {
    useInstallStore.setState({ platformHint: "safari-mac" });
    render(<InstallButton />);
    fireEvent.click(screen.getByTestId("install-app"));
    expect(screen.getByText("In the menu bar choose File → Add to Dock.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("install-dialog-scrim"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
