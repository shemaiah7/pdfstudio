// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NotePopover from "./NotePopover";

afterEach(cleanup);
describe("NotePopover", () => {
  it("commits the draft on outside pointerdown", async () => {
    const onDone = vi.fn(), onClose = vi.fn();
    render(<NotePopover left={0} top={0} text="a" onDone={onDone} onDelete={vi.fn()} onClose={onClose} />);
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "ab" } });
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onDone).toHaveBeenCalledWith("ab");
  });
  it("ignores the pointerdown that created it, then closes on later outside pointerdowns", async () => {
    const onClose = vi.fn();
    render(<NotePopover left={0} top={0} text="" onDone={vi.fn()} onDelete={vi.fn()} onClose={onClose} />);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
