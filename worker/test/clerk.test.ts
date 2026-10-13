import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

describe("verifyClerkJwt issuer normalisation", () => {
  it("ignores a trailing slash on the token iss or on CLERK_ISSUER", async () => {
    expect(await verifyClerkJwt(await sign({ ...good(), iss: `${env.CLERK_ISSUER}/` }), env)).toEqual({ sub: "user_abc" });
    expect(await verifyClerkJwt(await sign(good()), { ...env, CLERK_ISSUER: `${env.CLERK_ISSUER}/` })).toEqual({ sub: "user_abc" });
    expect(await verifyClerkJwt(await sign({ ...good(), iss: `${env.CLERK_ISSUER}.evil/` }), env)).toBeNull();
  });
});

describe("JWKS key rotation", () => {
  afterAll(async () => { const s = await makeSigner(); sign = s.sign; setJwksForTest([s.jwk]); });
  it("refetches once on an unknown kid with a fresh cache, at most once per 60 s", async () => {
    const a = await makeSigner(), b = await makeSigner();
    const jwkB = { ...b.jwk, kid: "k2" } as JsonWebKey;
    let keys: JsonWebKey[] = [a.jwk];
    let fetches = 0;
    const fetchFn = (async () => { fetches++; return Response.json({ keys }); }) as unknown as typeof fetch;
    setJwksForTest(null);
    const t = nowSec();
    expect(await verifyClerkJwt(await a.sign(good()), env, t, fetchFn)).toEqual({ sub: "user_abc" });
    expect(fetches).toBe(1);
    keys = [a.jwk, jwkB]; // Clerk rotated in a new signing key
    const rotated = await b.sign(good(), { alg: "RS256", kid: "k2", typ: "JWT" });
    expect(await verifyClerkJwt(rotated, env, t + 1, fetchFn)).toEqual({ sub: "user_abc" });
    expect(fetches).toBe(2);
    const unknown = await b.sign(good(), { alg: "RS256", kid: "nope", typ: "JWT" });
    expect(await verifyClerkJwt(unknown, env, t + 2, fetchFn)).toBeNull();
    expect(await verifyClerkJwt(unknown, env, t + 30, fetchFn)).toBeNull();
    expect(fetches).toBe(2); // rate-limited
    await verifyClerkJwt(unknown, env, t + 62, fetchFn);
    expect(fetches).toBe(3);
  });
});
