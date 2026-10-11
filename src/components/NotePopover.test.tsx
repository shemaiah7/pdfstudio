// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NotePopover from "./NotePopover";

afterEach(cleanup);
describe("NotePopover", () => {
  it("commits the draft on outside pointerdown", () => {
    const onDone = vi.fn(), onClose = vi.fn();
    render(<NotePopover left={0} top={0} text="a" onDone={onDone} onDelete={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "ab" } });
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onDone).toHaveBeenCalledWith("ab");
  });
});
