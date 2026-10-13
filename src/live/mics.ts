// src/live/mics.ts
export interface Mic { deviceId: string; label: string }
export const MIC_KEY = "pdfstudio.mic";

/** Audio inputs the browser knows about; labels are empty until microphone permission has been granted. */
export async function listMics(): Promise<Mic[]> {
  try {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!md?.enumerateDevices) return [];
    const all = await md.enumerateDevices();
    const inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
    return inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch { return []; }
}

export function getSavedMic(): string | null {
  try { return localStorage.getItem(MIC_KEY) || null; } catch { return null; }
}
export function saveMic(id: string | null): void {
  try { if (id) localStorage.setItem(MIC_KEY, id); else localStorage.removeItem(MIC_KEY); } catch { /* storage unavailable */ }
}

/** The preferred device if it is still plugged in, otherwise undefined (system default). */
export function resolveMic(preferred: string | null | undefined, list: Mic[]): string | undefined {
  return preferred && list.some((m) => m.deviceId === preferred) ? preferred : undefined;
}

/** Calls back when devices are plugged or unplugged; returns an unsubscribe function. */
export function onDeviceChange(cb: () => void): () => void {
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.addEventListener) return () => {};
  md.addEventListener("devicechange", cb);
  return () => md.removeEventListener("devicechange", cb);
}
