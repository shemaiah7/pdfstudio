import type { Plan } from "./plan";

export interface SessionPayload { vid: string; exp: number; plan?: Plan; uid?: string }
export function sessionPlan(s: SessionPayload): Plan { return s.plan ?? "anon"; }

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function utcDay(now: number = Date.now() / 1000): string {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

export async function visitorId(ip: string, secret: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}|${day}|${ip}`));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const p = b64url(JSON.stringify(payload));
  return `${p}.${await hmac(p, secret)}`;
}

export async function verifySession(token: string, secret: string, now: number = Date.now() / 1000): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = Uint8Array.from(fromB64url(sig), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (sigBytes.length !== 32) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(p)))) return null;
  try {
    const payload = JSON.parse(fromB64url(p)) as SessionPayload;
    if (typeof payload.vid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.plan !== undefined && !["anon", "free", "trial", "pro"].includes(payload.plan)) return null;
    if (payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
