import { MAX_PDF_BYTES } from "./config";

export type NavTarget = "app" | "external" | "block";

export function navigationTarget(url: string, origins: string[]): NavTarget {
  let u: URL;
  try { u = new URL(url); } catch { return "block"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "block";
  return origins.includes(u.origin) ? "app" : "external";
}

export function allowPermission(permission: string, requestingUrl: string, origins: string[], mediaTypes?: string[]): boolean {
  if (permission === "media") {
    if (mediaTypes && !mediaTypes.every((t) => t === "audio")) return false; // microphone only, never the camera
  } else if (permission !== "clipboard-sanitized-write") return false;
  try { return origins.includes(new URL(requestingUrl).origin); } catch { return false; }
}

export function isOpenablePdf(path: string, size: number): boolean {
  return /\.pdf$/i.test(path) && size > 0 && size <= MAX_PDF_BYTES;
}

export function pdfPathsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith("-") && /\.pdf$/i.test(a));
}
