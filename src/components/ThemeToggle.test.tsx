// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle";
import { useThemeStore } from "../store/theme";

afterEach(() => { cleanup(); useThemeStore.getState().setPreference("system"); });

describe("ThemeToggle", () => {
  it("aria-label follows the preference as it is clicked through", () => {
    useThemeStore.getState().setPreference("system");
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.getAttribute("aria-label")).toBe("Theme: System");
    expect(btn.getAttribute("title")).toBe("Theme: System (click to change)");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-label")).toBe("Theme: Light");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-label")).toBe("Theme: Dark");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-label")).toBe("Theme: System");
  });
});
