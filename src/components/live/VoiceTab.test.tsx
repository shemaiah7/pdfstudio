// src/components/live/VoiceTab.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import VoiceTab from "./VoiceTab";
import { useLiveStore } from "../../store/live";
import { useDocumentStore } from "../../store/document";
import { useAccount } from "../../account/store";
import { useSheets } from "../account/useGate";

const start = vi.fn(async () => {}); const end = vi.fn(async () => {}); const setMuted = vi.fn(); const acknowledge = vi.fn(); const setMic = vi.fn();
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); useAccount.setState({ me: null, loading: false }); useSheets.setState({ open: null }); });
beforeEach(() => {
  start.mockClear(); end.mockClear(); setMuted.mockClear(); acknowledge.mockClear(); setMic.mockClear();
  useLiveStore.setState({ status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, unlimited: false, resetAt: null, muted: false, acknowledged: false, searching: false, keywordMode: false, conversationId: null, micId: null, mics: [], start, end, setMuted, acknowledge, setMic });
  useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map([["s", { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" }]]), pages: [{ id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] });
});

describe("VoiceTab", () => {
  it("shows Owner · unlimited instead of the minutes meter", () => {
    useLiveStore.setState({ unlimited: true, remainingSeconds: null });
    const { container } = render(<VoiceTab />);
    expect(screen.getByText("Owner · unlimited")).toBeTruthy();
    expect(container.querySelector(".voice-meter")).toBeNull();
    expect(screen.queryByText(/min left today/)).toBeNull();
    useLiveStore.setState({ unlimited: false });
  });
  it("shows Owner · unlimited while live", () => {
    useLiveStore.setState({ status: "live", unlimited: true, remainingSeconds: null, seconds: 5 });
    const { container } = render(<VoiceTab />);
    expect(screen.getByTestId("voice-status").textContent).toContain("Owner · unlimited");
    expect(container.querySelector(".voice-meter")).toBeNull();
    useLiveStore.setState({ unlimited: false });
  });
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
  it("paywall on with plan limits: the disclosure states the plan's voice minutes per day", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true, limits: { aiDay: 5, aiMonth: 155, voiceDaySec: 300, voiceMonthSec: 9300, ocrMonth: 0, edit: false } } as never });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VoiceTab />);
    expect(screen.getByText(/About \$0\.10 per minute, 5 minutes per day\./)).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/5 minutes per day\.$/));
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
  it("shows a normal end as a muted notice, not an error", () => {
    useLiveStore.setState({ status: "idle", error: "Session ended", acknowledged: true });
    render(<VoiceTab />);
    const notice = screen.getByTestId("voice-notice");
    expect(notice.textContent).toBe("Session ended");
    expect(notice.className).toBe("muted");
    expect(screen.queryByTestId("voice-error")).toBeNull();
    expect(screen.getByTestId("voice-start").textContent).toBe("Start voice session");
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
  it("anonymous with the paywall on: Start opens the upgrade sheet and does not start", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VoiceTab />);
    const btn = screen.getByTestId("voice-start") as HTMLButtonElement;
    expect(btn.className).toContain("locked");
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(useSheets.getState().open).toBe("upgrade");
    expect(confirm).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it("limit error on a free plan offers Upgrade to Pro; on pro it shows no button", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useLiveStore.setState({ status: "error", error: "Monthly limit reached. Resets Nov 1.", limited: true } as never);
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    const { unmount } = render(<VoiceTab />);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(useSheets.getState().open).toBe("paywall");
    unmount();
    useAccount.setState({ me: { plan: "pro", paywall: true } as never });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-error").textContent).toBe("Monthly limit reached. Resets Nov 1.");
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).toBeNull();
  });
  it("lists System default plus devices and calls setMic on change", () => {
    useLiveStore.setState({ mics: [{ deviceId: "a", label: "MacBook Mic" }, { deviceId: "b", label: "iPhone Mic" }], micId: "a" });
    render(<VoiceTab />);
    const select = screen.getByTestId("voice-mic") as HTMLSelectElement;
    expect(screen.getByLabelText("Microphone")).toBe(select);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["System default", "MacBook Mic", "iPhone Mic"]);
    expect(select.value).toBe("a");
    expect(screen.queryByText("Allow the microphone once to see your devices.")).toBeNull();
    fireEvent.change(select, { target: { value: "b" } });
    expect(setMic).toHaveBeenCalledWith("b");
    fireEvent.change(select, { target: { value: "" } });
    expect(setMic).toHaveBeenLastCalledWith(null);
  });
  it("with no devices listed still offers System default and hints to allow the microphone", () => {
    render(<VoiceTab />);
    const select = screen.getByTestId("voice-mic") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["System default"]);
    expect(screen.getByText("Allow the microphone once to see your devices.")).toBeTruthy();
  });
  it("shows the picker in the live state too", () => {
    useLiveStore.setState({ status: "live", mics: [{ deviceId: "a", label: "MacBook Mic" }] });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-mic")).toBeTruthy();
  });
});
