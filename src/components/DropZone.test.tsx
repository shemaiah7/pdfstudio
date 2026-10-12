// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DropZone from "./DropZone";

describe("DropZone", () => {
  afterEach(cleanup);
  it("shows the voice hint on the empty state", () => {
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.getByTestId("voice-hint").textContent).toMatch(/talk to it/);
  });
});
