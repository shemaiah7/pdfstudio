import { describe, it, expect } from "vitest";
import { can } from "./capabilities";
describe("can", () => {
  it.each([
    ["anon", "edit", false], ["anon", "ai", false], ["free", "ai", true], ["free", "edit", false], ["free", "deepOcr", false],
    ["trial", "edit", true], ["pro", "deepOcr", true], ["free", "voice", true],
  ] as const)("%s %s → %s (paywall on)", (plan, f, ok) => { expect(can(plan, f, true)).toBe(ok); });
  it("paywall off: everything allowed", () => { expect(can("anon", "edit", false)).toBe(true); });
});
