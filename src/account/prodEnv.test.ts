import { describe, it, expect } from "vitest";
import { checkProdEnv } from "../../scripts/prodEnv";

const base = { VITE_AI_URL: "https://ai.example.com", VITE_TURNSTILE_SITE_KEY: "0x4AAAA" };
describe("checkProdEnv", () => {
  it("passes with the required values and no Clerk key", () => { expect(checkProdEnv(base)).toEqual([]); });
  it("passes with an empty Clerk key", () => { expect(checkProdEnv({ ...base, VITE_CLERK_PUBLISHABLE_KEY: "" })).toEqual([]); });
  it("passes with a pk_live_ key", () => { expect(checkProdEnv({ ...base, VITE_CLERK_PUBLISHABLE_KEY: "pk_live_x" })).toEqual([]); });
  it("rejects a pk_test_ key", () => { expect(checkProdEnv({ ...base, VITE_CLERK_PUBLISHABLE_KEY: "pk_test_x" })).toEqual(["VITE_CLERK_PUBLISHABLE_KEY"]); });
  it("still requires the AI url and Turnstile key", () => {
    expect(checkProdEnv({ VITE_AI_URL: "http://localhost:8787", VITE_TURNSTILE_SITE_KEY: "" })).toEqual(["VITE_AI_URL", "VITE_TURNSTILE_SITE_KEY"]);
  });
});
