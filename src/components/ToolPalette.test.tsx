// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ToolPalette from "./ToolPalette";
import { useToolsStore } from "../store/tools";
afterEach(cleanup);
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
});
