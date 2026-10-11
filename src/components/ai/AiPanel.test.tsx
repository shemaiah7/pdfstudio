// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AiPanel from "./AiPanel";
import { useAiStore } from "../../store/ai";

vi.mock("../../ai/turnstile", () => ({ getTurnstileToken: async () => "tok" }));

describe("AiPanel", () => {
  afterEach(cleanup);

  it("shows the privacy notice once and the four tabs", () => {
    render(<AiPanel />);
    expect(screen.getByTestId("ai-notice").textContent).toMatch(/never leaves your browser/);
    fireEvent.click(screen.getByText("Got it"));
    expect(screen.queryByTestId("ai-notice")).toBeNull();
    for (const t of ["summarize", "ask", "rewrite", "extract"]) expect(screen.getByTestId(`ai-tab-${t}`)).toBeTruthy();
  });

  it("disables Run while limited and shows the footer", () => {
    useAiStore.setState({ limitedUntil: Math.floor(Date.now() / 1000) + 3600, remaining: { requests: 0, tokens: 0, resetAt: 1 } });
    render(<AiPanel />);
    expect((screen.getByTestId("ai-run") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("ai-footer").textContent).toMatch(/0 requests left/);
    useAiStore.setState({ limitedUntil: null, remaining: null });
  });
});
