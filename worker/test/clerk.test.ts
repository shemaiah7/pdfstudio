import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { verifyClerkJwt, setJwksForTest } from "../src/clerk";
import { b64u, good, nowSec, makeSigner } from "./jwt-helpers";

let sign: Awaited<ReturnType<typeof makeSigner>>["sign"];
const now = nowSec();

beforeAll(async () => {
  const s = await makeSigner();
  sign = s.sign;
  setJwksForTest([s.jwk]);
});

describe("verifyClerkJwt", () => {
  it("accepts a valid token", async () => { expect(await verifyClerkJwt(await sign(good()), env)).toEqual({ sub: "user_abc" }); });
  it("rejects expired", async () => { expect(await verifyClerkJwt(await sign({ ...good(), exp: now - 10 }), env)).toBeNull(); });
  it("rejects wrong issuer", async () => { expect(await verifyClerkJwt(await sign({ ...good(), iss: "https://evil.test" }), env)).toBeNull(); });
  it("rejects unknown kid", async () => { expect(await verifyClerkJwt(await sign(good(), { alg: "RS256", kid: "nope" }), env)).toBeNull(); });
  it("rejects alg none and HS256", async () => {
    const p = b64u(JSON.stringify(good()));
    expect(await verifyClerkJwt(`${b64u(JSON.stringify({ alg: "none", kid: "k1" }))}.${p}.`, env)).toBeNull();
    expect(await verifyClerkJwt(`${b64u(JSON.stringify({ alg: "HS256", kid: "k1" }))}.${p}.${b64u("x")}`, env)).toBeNull();
  });
  it("rejects a tampered payload", async () => {
    const t = (await sign(good())).split(".");
    t[1] = b64u(JSON.stringify({ ...good(), sub: "user_other" }));
    expect(await verifyClerkJwt(t.join("."), env)).toBeNull();
  });
  it("rejects azp not in ALLOWED_ORIGIN", async () => { expect(await verifyClerkJwt(await sign({ ...good(), azp: "https://evil.test" }), env)).toBeNull(); });
});
