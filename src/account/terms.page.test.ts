import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TERMS_CHECKBOX, TERMS_VERSION } from "./terms";

const html = readFileSync(resolve(__dirname, "../../public/terms.html"), "utf8");

describe("public/terms.html", () => {
  it("contains the verbatim checkbox sentence", () => { expect(html).toContain(TERMS_CHECKBOX); });
  it("shows the current terms version", () => { expect(html).toContain(TERMS_VERSION); });
  it("carries the draft marker comment", () => { expect(html).toContain("<!-- DRAFT — legal review recommended before launch -->"); });
  it("describes Deep OCR as monthly and not on the free plan", () => {
    expect(html).not.toContain("Deep OCR pages are limited each day");
    expect(html).toContain("Deep OCR pages are limited each month and are not included on the free plan");
  });
  it("has no owner placeholders left and names the operator, refunds and contact", () => {
    expect(html).not.toMatch(/\[(REFUND|CONTACT)[^\]]*\]/);
    expect(html).toContain("operated by Melantech LLC");
    expect(html).toContain("payments are non-refundable");
    expect(html).toContain("mailto:shemaiah.sanders@melantechinnovations.com");
  });
});
