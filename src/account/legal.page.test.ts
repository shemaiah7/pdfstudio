import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const terms = readFileSync(resolve(__dirname, "../../public/terms.html"), "utf8");
const privacy = readFileSync(resolve(__dirname, "../../public/privacy.html"), "utf8");

describe("terms of use clauses the owner chose", () => {
  it.each([
    ["New Jersey law and courts", "governed by the laws of the State of New Jersey"],
    ["courts, not arbitration", "state or federal courts located in New Jersey"],
    ["cap = fees paid", "limited to the amount you paid us for SentinelPDF in the 12 months before the claim"],
    ["non-waivable carve-out", "does not limit liability for fraud, gross negligence, wilful misconduct"],
    ["indemnification", "agree to defend and reimburse Melantech Innovations L.L.C."],
    ["automatic renewal", "Pro renews automatically"],
    ["AI provider retention", "may keep it for a limited time for safety and abuse monitoring"],
    ["suspension", "We may suspend or close an account"],
    ["age", "at least 18 years old"],
    ["links the privacy policy", 'href="/privacy"'],
  ])("%s", (_name, text) => { expect(terms).toContain(text); });
  it("has no arbitration clause", () => { expect(terms.toLowerCase()).not.toContain("arbitrat"); });
});

describe("privacy policy", () => {
  it("names every processor and the deletion route", () => {
    for (const s of ["Clerk", "Stripe", "Cloudflare", "Anthropic", "ElevenLabs", "Delete account", "do not sell"]) expect(privacy).toContain(s);
  });
  it("is a full page with a title and viewport", () => {
    expect(privacy).toContain("<title>SentinelPDF — Privacy policy</title>");
    expect(privacy).toContain('name="viewport"');
  });
});
