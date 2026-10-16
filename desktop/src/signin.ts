import { LINK_SCHEME } from "./rules";

export interface PendingSignIn { state: string; expiresAt: number }
export const SIGNIN_TTL_MS = 600_000;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const TICKET_RE = /^[A-Za-z0-9._~-]{1,4096}$/;

export function createPendingSignIn(now: number, random: (n: number) => Uint8Array): PendingSignIn {
  const state = Buffer.from(random(32)).toString("base64url");
  return { state, expiresAt: now + SIGNIN_TTL_MS };
}

/** { ticket, state } from sentinelpdf://signin?ticket=…&state=…, or null for anything else. */
export function signInLinkFrom(url: string): { ticket: string; state: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${LINK_SCHEME}:` || u.host.toLowerCase() !== "signin") return null;
  if (u.pathname !== "" && u.pathname !== "/") return null;
  if (u.hash) return null;
  const keys = [...u.searchParams.keys()].sort();
  if (keys.length !== 2 || keys[0] !== "state" || keys[1] !== "ticket") return null;
  const ticket = u.searchParams.get("ticket") ?? "", state = u.searchParams.get("state") ?? "";
  if (!TICKET_RE.test(ticket) || !STATE_RE.test(state)) return null;
  return { ticket, state };
}

export function consumeSignIn(pending: PendingSignIn | null, link: { state: string }, now: number): "ok" | "mismatch" | "expired" {
  if (!pending || pending.state !== link.state) return "mismatch";
  return now < pending.expiresAt ? "ok" : "expired";
}
