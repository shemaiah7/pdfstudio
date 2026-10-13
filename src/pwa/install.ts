import { create } from "zustand";

export type PlatformHint = "prompt" | "ios" | "safari-mac" | "none";

// Chromium's install prompt event; not in lib.dom.
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PlatformInfo { ua: string; platform: string; maxTouchPoints: number }

export const isIos = ({ ua, platform, maxTouchPoints }: PlatformInfo): boolean =>
  /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);

export const isSafariMac = ({ ua, platform, maxTouchPoints }: PlatformInfo): boolean =>
  !isIos({ ua, platform, maxTouchPoints }) && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(ua);

export const computeHint = (info: PlatformInfo, canPrompt: boolean): PlatformHint =>
  isIos(info) ? "ios" : isSafariMac(info) ? "safari-mac" : canPrompt ? "prompt" : "none";

const readPlatform = (): PlatformInfo =>
  typeof navigator === "undefined" ? { ua: "", platform: "", maxTouchPoints: 0 }
    : { ua: navigator.userAgent ?? "", platform: navigator.platform ?? "", maxTouchPoints: navigator.maxTouchPoints ?? 0 };

export const isStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  const mm = typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)").matches : false;
  return mm || (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

let deferred: BeforeInstallPromptEvent | null = null;

interface InstallState {
  canPrompt: boolean;
  installed: boolean;
  platformHint: PlatformHint;
  install(): Promise<void>;
}

export const useInstallStore = create<InstallState>((set) => ({
  canPrompt: false,
  installed: isStandalone(),
  platformHint: computeHint(readPlatform(), false),
  install: async () => {
    const ev = deferred;
    if (!ev) return;
    deferred = null;
    set({ canPrompt: false, platformHint: computeHint(readPlatform(), false) });
    try { await ev.prompt(); } catch { /* prompt already used or blocked */ }
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    useInstallStore.setState({ canPrompt: true, platformHint: computeHint(readPlatform(), true) });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    useInstallStore.setState({ installed: true, canPrompt: false, platformHint: computeHint(readPlatform(), false) });
  });
}
