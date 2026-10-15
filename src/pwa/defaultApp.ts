import { isIos, isSafariMac, readPlatform, useInstallStore, type PlatformInfo } from "./install";

export type DesktopOs = "mac" | "windows";

export const desktopOs = (info: PlatformInfo): DesktopOs | null => {
  if (isIos(info) || isSafariMac(info)) return null;
  if (/Macintosh/.test(info.ua)) return "mac";
  if (/Windows/.test(info.ua)) return "windows";
  return null;
};

export const DEFAULT_STEPS: Record<DesktopOs, string[]> = {
  mac: [
    "In Finder, select any PDF and press ⌘I (File → Get Info).",
    "Under “Open with”, choose SentinelPDF.",
    "Click Change All…, then Continue.",
    "The first time a PDF opens, your browser asks to confirm. Keep “Remember my choice” ticked and click Open.",
    "If the PDF is in iCloud Drive, macOS asks once whether your browser may open it. Click Allow.",
  ],
  windows: [
    "Right-click any PDF and choose Open with → Choose another app.",
    "Pick SentinelPDF. If it isn't listed, click More apps.",
    "Select Always (or tick “Always use this app”), then OK.",
    "The first time a PDF opens, your browser asks to confirm. Keep “Remember my choice” ticked and click Open.",
  ],
};

const KEY = "pdfstudio.defaultPrompt";

export const promptDone = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const markPromptDone = (): void => { try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ } };

export const useDefaultApp = (): { os: DesktopOs | null; installed: boolean } => {
  const installed = useInstallStore((s) => s.installed);
  return { os: desktopOs(readPlatform()), installed };
};
