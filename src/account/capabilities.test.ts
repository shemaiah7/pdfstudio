// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { can, paywallEnabled } from "./capabilities";
describe("can", () => {
  it.each([
    ["anon", "edit", false], ["anon", "ai", false], ["free", "ai", true], ["free", "edit", false], ["free", "deepOcr", false],
    ["trial", "edit", true], ["pro", "deepOcr", true], ["free", "voice", true],
  ] as const)("%s %s → %s (paywall on)", (plan, f, ok) => { expect(can(plan, f, true)).toBe(ok); });
  it("paywall off: everything allowed", () => { expect(can("anon", "edit", false)).toBe(true); });
});

describe("paywallEnabled", () => {
  afterEach(() => { vi.unstubAllEnvs(); window.history.replaceState(null, "", "/"); });
  it("follows VITE_PAYWALL_ENABLED", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    expect(paywallEnabled()).toBe(true);
    vi.stubEnv("VITE_PAYWALL_ENABLED", "false");
    expect(paywallEnabled()).toBe(false);
  });
  it("dev builds turn it on with ?paywall", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "false");
    vi.stubEnv("DEV", true);
    window.history.replaceState(null, "", "/?paywall=1");
    expect(paywallEnabled()).toBe(true);
  });
  it("production builds ignore ?paywall", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "false");
    vi.stubEnv("DEV", false);
    window.history.replaceState(null, "", "/?paywall=1");
    expect(paywallEnabled()).toBe(false);
  });
});
