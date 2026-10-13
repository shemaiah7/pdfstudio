// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeHint, useInstallStore, type PlatformInfo } from "./install";

const IPHONE: PlatformInfo = { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const IPADOS: PlatformInfo = { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 };
const MAC_SAFARI: PlatformInfo = { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 };
const MAC_CHROME: PlatformInfo = { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", platform: "MacIntel", maxTouchPoints: 0 };
const WIN_CHROME: PlatformInfo = { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0 };

describe("computeHint", () => {
  it("maps platform + prompt availability to a hint", () => {
    expect(computeHint(IPHONE, false)).toBe("ios");
    expect(computeHint(IPADOS, false)).toBe("ios");
    expect(computeHint(MAC_SAFARI, false)).toBe("safari-mac");
    expect(computeHint(MAC_CHROME, true)).toBe("prompt");
    expect(computeHint(MAC_CHROME, false)).toBe("none");
    expect(computeHint(WIN_CHROME, true)).toBe("prompt");
    expect(computeHint(WIN_CHROME, false)).toBe("none");
  });
});

describe("useInstallStore", () => {
  beforeEach(() => { useInstallStore.setState({ canPrompt: false, installed: false, platformHint: "none" }); });

  it("captures beforeinstallprompt, and install() prompts once and clears it", async () => {
    const prompt = vi.fn(async () => {});
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(useInstallStore.getState().canPrompt).toBe(true);
    await useInstallStore.getState().install();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(useInstallStore.getState().canPrompt).toBe(false);
    await useInstallStore.getState().install();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("appinstalled marks the app installed", () => {
    window.dispatchEvent(new Event("appinstalled"));
    expect(useInstallStore.getState().installed).toBe(true);
  });
});

describe("standalone detection", () => {
  it("is installed when display-mode is standalone", async () => {
    vi.resetModules();
    window.matchMedia = ((q: string) => ({ matches: q === "(display-mode: standalone)", addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const mod = await import("./install");
    expect(mod.useInstallStore.getState().installed).toBe(true);
  });
});
