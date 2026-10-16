import { describe, it, expect, vi } from "vitest";
import { stateFromSearch, appLink, fetchDesktopTicket } from "./desktopTicket";
const S = "A".repeat(43);
describe("stateFromSearch", () => {
  it("accepts exactly one valid state", () => { expect(stateFromSearch(`?state=${S}`)).toBe(S); });
  it("rejects missing, short, junk or extra params", () => {
    for (const s of ["", "?", "?state=short", `?state=${S}&x=1`, `?state=${S}!`, "?ticket=1"]) expect(stateFromSearch(s)).toBeNull();
  });
});
describe("appLink", () => {
  it("puts ticket and state in the query", () => { expect(appLink("t.k-~_", S)).toBe(`sentinelpdf://signin?ticket=t.k-~_&state=${S}`); });
});
describe("fetchDesktopTicket", () => {
  it("posts with the bearer token and returns the ticket", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ticket: "tkt" }), { status: 200 }));
    expect(await fetchDesktopTicket("https://ai.x", "jwt1", f as unknown as typeof fetch)).toEqual({ ticket: "tkt" });
    expect(f).toHaveBeenCalledWith("https://ai.x/desktop/ticket", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer jwt1" }) }));
  });
  it("maps errors", async () => {
    for (const [status, error] of [[429, "rate_limited"], [401, "unauthorized"], [503, "accounts_unavailable"], [502, "upstream"]] as const) {
      const f = vi.fn(async () => new Response(JSON.stringify({ error }), { status }));
      expect(await fetchDesktopTicket("https://ai.x", "j", f as unknown as typeof fetch)).toEqual({ error });
    }
  });
});
