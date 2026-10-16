export const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
export function stateFromSearch(search: string): string | null {
  const p = new URLSearchParams(search);
  const keys = [...p.keys()].filter((k) => !k.startsWith("__clerk_")); // Clerk adds its own params after a redirect
  if (keys.length !== 1 || keys[0] !== "state") return null;
  const s = p.get("state") ?? "";
  return STATE_RE.test(s) ? s : null;
}
export const appLink = (ticket: string, state: string): string => `sentinelpdf://signin?ticket=${encodeURIComponent(ticket)}&state=${state}`;
type TicketError = "rate_limited" | "unauthorized" | "accounts_unavailable" | "upstream";
export async function fetchDesktopTicket(baseUrl: string, jwt: string, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<{ ticket: string } | { error: TicketError }> {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/desktop/ticket`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { ticket?: string; error?: TicketError };
    if (res.ok && body.ticket) return { ticket: body.ticket };
    return { error: body.error ?? (res.status === 429 ? "rate_limited" : res.status === 401 ? "unauthorized" : res.status === 503 ? "accounts_unavailable" : "upstream") };
  } catch { return { error: "upstream" }; }
}
