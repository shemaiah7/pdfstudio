const KEY = "pdfstudio.signature";
const PNG_PREFIX = "data:image/png;base64,";

export function loadSignature(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.startsWith(PNG_PREFIX) ? v : null;
  } catch { return null; }
}
export function saveSignature(png: string): boolean {
  try { localStorage.setItem(KEY, png); return true; } catch { return false; }
}
export function forgetSignature(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export function canRemember(): boolean {
  try {
    const probe = "pdfstudio.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch { return false; }
}
