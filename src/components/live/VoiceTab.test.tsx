// src/components/live/VoiceTab.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import VoiceTab from "./VoiceTab";
import { useLiveStore } from "../../store/live";
import { useDocumentStore } from "../../store/document";

const start = vi.fn(async () => {}); const end = vi.fn(async () => {}); const setMuted = vi.fn(); const acknowledge = vi.fn();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  start.mockClear(); end.mockClear(); setMuted.mockClear(); acknowledge.mockClear();
  useLiveStore.setState({ status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, resetAt: null, muted: false, acknowledged: false, searching: false, keywordMode: false, conversationId: null, start, end, setMuted, acknowledge });
  useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map([["s", { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" }]]), pages: [{ id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] });
});

describe("VoiceTab", () => {
  it("is disabled without a document", () => {
    useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map(), pages: [] });
    render(<VoiceTab />);
    expect((screen.getByTestId("voice-start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Open a document first.")).toBeTruthy();
  });
  it("asks for the disclosure once, then starts", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VoiceTab />);
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(confirm).toHaveBeenCalledWith("Voice sends your microphone audio to ElevenLabs and the passages of this document needed to answer each question to ElevenLabs and Anthropic. Recordings are not kept. About $0.10 per minute, 30 minutes per day.");
    expect(acknowledge).toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    useLiveStore.setState({ acknowledged: true });
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("does not start when the disclosure is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<VoiceTab />);
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(start).not.toHaveBeenCalled();
  });
  it("renders the live state: captions, elapsed, remaining, searching, keyword note, mute and end", () => {
    useLiveStore.setState({ status: "live", seconds: 65, remainingSeconds: 1500, captions: [{ role: "you", text: "what dose" }, { role: "assistant", text: "Five milligrams" }], searching: true, keywordMode: true });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-captions").textContent).toContain("what dose");
    expect(screen.getByTestId("voice-captions").textContent).toContain("Five milligrams");
    expect(screen.getByTestId("voice-status").textContent).toContain("1:05");
    expect(screen.getByTestId("voice-status").textContent).toContain("25 min left today");
    expect(screen.getByText("Searching the document…")).toBeTruthy();
    expect(screen.getByText("Using keyword matching (search model not loaded)")).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-mute"));
    expect(setMuted).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("voice-end"));
    expect(end).toHaveBeenCalled();
  });
  it("shows Unmute when muted and the error with Retry", () => {
    useLiveStore.setState({ status: "live", muted: true });
    const { unmount } = render(<VoiceTab />);
    expect(screen.getByTestId("voice-mute").textContent).toBe("Unmute");
    unmount();
    useLiveStore.setState({ status: "error", error: "Voice service unavailable right now.", acknowledged: true });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-error").textContent).toBe("Voice service unavailable right now.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(start).toHaveBeenCalled();
  });
});
