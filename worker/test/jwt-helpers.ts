import { env } from "cloudflare:test";

export const b64u = (b: ArrayBuffer | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const nowSec = () => Math.floor(Date.now() / 1000);

export const good = () => {
  const now = nowSec();
  return { sub: "user_abc", iss: env.CLERK_ISSUER, exp: now + 60, nbf: now - 5, iat: now - 5, azp: "http://localhost:5173" };
};

/** Generates a local RS256 key pair; `sign` mints JWTs, `jwk` is the matching public JWKS entry (kid k1). */
export async function makeSigner() {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  const jwk = { ...pub, kid: "k1", alg: "RS256", use: "sig" } as JsonWebKey;
  async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) {
    const h = b64u(JSON.stringify(header)), p = b64u(JSON.stringify(payload));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(sig)}`;
  }
  return { sign, jwk };
}
