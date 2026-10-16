import { describe, it, expect } from "vitest";
import { createPendingSignIn, signInLinkFrom, consumeSignIn, SIGNIN_TTL_MS } from "../src/signin";

const S = "A".repeat(43);
const rnd = (n: number) => new Uint8Array(n).fill(7);

describe("createPendingSignIn", () => {
  it("makes a 43-char base64url state that expires in 10 minutes", () => {
    const p = createPendingSignIn(1000, rnd);
    expect(p.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.expiresAt).toBe(1000 + SIGNIN_TTL_MS);
  });
});

describe("signInLinkFrom", () => {
  it("reads ticket and state from the query", () => {
    expect(signInLinkFrom(`sentinelpdf://signin?ticket=tkt_abc.1-2~x&state=${S}`)).toEqual({ ticket: "tkt_abc.1-2~x", state: S });
    expect(signInLinkFrom(`SENTINELPDF://SIGNIN/?ticket=t&state=${S}`)).toEqual({ ticket: "t", state: S });
  });
  it("rejects anything else", () => {
    for (const u of [
      `sentinelpdf://owner?ticket=t&state=${S}`,
      `sentinelpdf://signin?state=${S}`,
      "sentinelpdf://signin?ticket=t",
      `sentinelpdf://signin?ticket=t&state=${S}&x=1`,
      "sentinelpdf://signin?ticket=t&state=short",
      `sentinelpdf://signin#ticket=t&state=${S}`,
      `sentinelpdf://signin?ticket=${"a".repeat(4097)}&state=${S}`,
      `sentinelpdf://signin?ticket=bad%20space&state=${S}`,
      `https://sentinelpdf.com/?ticket=t&state=${S}`,
      "not a url",
    ]) expect(signInLinkFrom(u)).toBeNull();
  });
});

describe("consumeSignIn", () => {
  const p = { state: S, expiresAt: 5000 };
  it("ok only for the matching unexpired state", () => {
    expect(consumeSignIn(p, { state: S }, 4999)).toBe("ok");
    expect(consumeSignIn(p, { state: "B".repeat(43) }, 10)).toBe("mismatch");
    expect(consumeSignIn(p, { state: S }, 5000)).toBe("expired");
    expect(consumeSignIn(null, { state: S }, 10)).toBe("mismatch");
  });
});
