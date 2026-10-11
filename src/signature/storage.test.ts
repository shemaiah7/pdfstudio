// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSignature, saveSignature, forgetSignature } from "./storage";
beforeEach(() => localStorage.clear());
describe("signature storage", () => {
  it("round-trips and forgets", () => {
    expect(loadSignature()).toBeNull();
    expect(saveSignature("data:image/png;base64,AA==")).toBe(true);
    expect(loadSignature()).toBe("data:image/png;base64,AA==");
    forgetSignature();
    expect(loadSignature()).toBeNull();
  });
  it("ignores non-png values", () => { localStorage.setItem("pdfstudio.signature", "javascript:x"); expect(loadSignature()).toBeNull(); });
});
