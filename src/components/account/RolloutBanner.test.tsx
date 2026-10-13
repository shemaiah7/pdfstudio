// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { it, expect, afterEach, beforeEach } from "vitest";
import RolloutBanner from "./RolloutBanner";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("renders nothing without a notice", () => {
  const { container } = render(<RolloutBanner notice="" />);
  expect(container.innerHTML).toBe("");
});
it("shows the notice and remembers dismissal", () => {
  const { unmount } = render(<RolloutBanner notice="Nov 3" />);
  expect(screen.getByText("From Nov 3, AI and editing need a free account. Viewing stays free.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(localStorage.getItem("pdfstudio.rolloutDismissed")).toBe("1");
  unmount();
  const { container } = render(<RolloutBanner notice="Nov 3" />);
  expect(container.innerHTML).toBe("");
});
