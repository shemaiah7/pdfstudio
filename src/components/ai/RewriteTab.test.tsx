// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import RewriteTab from "./RewriteTab";
import { useAiStore } from "../../store/ai";
import { useDocumentStore } from "../../store/document";
import { loadFixture } from "../../test/loadFixture";
import { useAccount } from "../../account/store";
import { useSheets } from "../account/useGate";

describe("RewriteTab insert gating", () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); useAccount.setState({ me: null, loading: false }); useSheets.setState({ open: null }); });

  beforeEach(async () => {
    useAiStore.getState().resetForNewDocument();
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
  });

  it("disables Insert when the result overflows the selection region", async () => {
    const pageEntryId = useDocumentStore.getState().pages[0].id;
    useAiStore.setState((s) => ({ rewrite: { ...s.rewrite, status: "done", result: "x".repeat(2000),
      selection: { pageEntryId, text: "short", boxes: [{ x: 10, y: 300, width: 60, height: 14 }], fontSize: 12, bold: false, serif: false } } }));
    render(<RewriteTab disabled={false} />);
    await waitFor(() => expect(screen.getByText(/Too long to fit/)).toBeTruthy());
    expect((screen.getByTestId("ai-insert") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Insert when the result fits and adds an edit on click", async () => {
    const pageEntryId = useDocumentStore.getState().pages[0].id;
    useAiStore.setState((s) => ({ rewrite: { ...s.rewrite, status: "done", result: "ok",
      selection: { pageEntryId, text: "short", boxes: [{ x: 10, y: 300, width: 200, height: 14 }], fontSize: 12, bold: false, serif: false } } }));
    render(<RewriteTab disabled={false} />);
    const btn = screen.getByTestId("ai-insert") as HTMLButtonElement;
    expect(btn.disabled).toBe(true); // until the pdf-lib metrics are ready
    await waitFor(() => expect(btn.disabled).toBe(false));
    btn.click();
    expect(useDocumentStore.getState().edits.length).toBe(1);
  });

  it("free plan with the paywall on: Insert is locked, opens the paywall and adds no edit", async () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    const pageEntryId = useDocumentStore.getState().pages[0].id;
    useAiStore.setState((s) => ({ rewrite: { ...s.rewrite, status: "done", result: "ok",
      selection: { pageEntryId, text: "short", boxes: [{ x: 10, y: 300, width: 200, height: 14 }], fontSize: 12, bold: false, serif: false } } }));
    render(<RewriteTab disabled={false} />);
    const btn = screen.getByTestId("ai-insert") as HTMLButtonElement;
    expect(btn.className).toContain("locked");
    await waitFor(() => expect(btn.disabled).toBe(false));
    btn.click();
    expect(useSheets.getState().open).toBe("paywall");
    expect(useDocumentStore.getState().edits.length).toBe(0);
  });
});
