// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import RewriteTab from "./RewriteTab";
import { useAiStore } from "../../store/ai";
import { useDocumentStore } from "../../store/document";
import { loadFixture } from "../../test/loadFixture";

describe("RewriteTab insert gating", () => {
  afterEach(cleanup);

  beforeEach(async () => {
    useAiStore.getState().resetForNewDocument();
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
  });

  it("disables Insert when the result overflows the selection region", () => {
    const pageEntryId = useDocumentStore.getState().pages[0].id;
    useAiStore.setState((s) => ({ rewrite: { ...s.rewrite, status: "done", result: "x".repeat(2000),
      selection: { pageEntryId, text: "short", boxes: [{ x: 10, y: 300, width: 60, height: 14 }], fontSize: 12, bold: false, serif: false } } }));
    render(<RewriteTab disabled={false} />);
    expect((screen.getByTestId("ai-insert") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Too long to fit/)).toBeTruthy();
  });

  it("enables Insert when the result fits and adds an edit on click", () => {
    const pageEntryId = useDocumentStore.getState().pages[0].id;
    useAiStore.setState((s) => ({ rewrite: { ...s.rewrite, status: "done", result: "ok",
      selection: { pageEntryId, text: "short", boxes: [{ x: 10, y: 300, width: 200, height: 14 }], fontSize: 12, bold: false, serif: false } } }));
    render(<RewriteTab disabled={false} />);
    const btn = screen.getByTestId("ai-insert") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(useDocumentStore.getState().edits.length).toBe(1);
  });
});
