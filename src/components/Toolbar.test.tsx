// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Toolbar from "./Toolbar";
import { useDocumentStore } from "../store/document";
import { loadFixture } from "../test/loadFixture";

beforeEach(async () => {
  useDocumentStore.getState().reset();
  await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
});
afterEach(cleanup);

describe("Toolbar phone controls", () => {
  it("More actions toggles aria-expanded and the .tb-actions.open panel, and closes on Escape", () => {
    const { container } = render(<Toolbar scale={1} setScale={() => {}} onFiles={() => {}} onTogglePages={() => {}} pagesOpen={false} />);
    const more = screen.getByLabelText("More actions");
    const actions = container.querySelector(".tb-actions")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(actions.classList.contains("open")).toBe(false);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(actions.classList.contains("open")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(actions.classList.contains("open")).toBe(false);
  });

  it("Pages button reports its state and calls onTogglePages", () => {
    const toggle = vi.fn();
    render(<Toolbar scale={1} setScale={() => {}} onFiles={() => {}} onTogglePages={toggle} pagesOpen />);
    const pages = screen.getByLabelText("Pages");
    expect(pages.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(pages);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
