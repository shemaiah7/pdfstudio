// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AskTab from "./AskTab";
import { useAiStore } from "../../store/ai";
import { useSearchStore } from "../../store/search";

vi.mock("../../ai/turnstile", () => ({ getTurnstileToken: async () => "tok" }));

const setStatus = (status: "idle" | "ready") =>
  useSearchStore.setState((s) => ({ model: { ...s.model, status } }));

describe("AskTab", () => {
  afterEach(() => { cleanup(); setStatus("idle"); useAiStore.getState().resetForNewDocument(); });

  it("hides the search checkbox when the model is idle and shows it when ready", () => {
    setStatus("idle");
    const { unmount } = render(<AskTab disabled={false} />);
    expect(screen.queryByTestId("ask-use-search")).toBeNull();
    unmount();
    setStatus("ready");
    render(<AskTab disabled={false} />);
    expect(screen.getByTestId("ask-use-search")).toBeTruthy();
  });

  it("shows the passage count", () => {
    useAiStore.setState((s) => ({ chat: { ...s.chat, passages: 3 } }));
    render(<AskTab disabled={false} />);
    expect(screen.getByTestId("ask-passages").textContent).toBe("Answering from 3 passages");
  });
});
