import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { checkQuota, recordUsage, nextUtcMidnight, DAILY_REQUESTS, DAILY_TOKENS, BURST_REQUESTS } from "../src/quota";

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0) / 1000;

describe("quota", () => {
  it("allows the first request with full remaining", async () => {
    const r = await checkQuota(env.QUOTA, "v1", T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.remaining).toEqual({ requests: DAILY_REQUESTS, tokens: DAILY_TOKENS });
      expect(r.resetAt).toBe(nextUtcMidnight(T0));
      expect(r.day).toBe("2026-10-10");
    }
  });

  it("blocks the 21st request of the day", async () => {
    for (let i = 0; i < DAILY_REQUESTS; i++) await recordUsage(env.QUOTA, "v2", "2026-10-10", 10);
    const r = await checkQuota(env.QUOTA, "v2", T0);
    expect(r).toMatchObject({ ok: false, reason: "daily_limit", resetAt: nextUtcMidnight(T0) });
  });

  it("blocks when tokens are exhausted", async () => {
    await recordUsage(env.QUOTA, "v3", "2026-10-10", DAILY_TOKENS);
    const r = await checkQuota(env.QUOTA, "v3", T0);
    expect(r).toMatchObject({ ok: false, reason: "daily_limit" });
  });

  it("blocks the 6th request within a minute", async () => {
    for (let i = 0; i < BURST_REQUESTS; i++) expect((await checkQuota(env.QUOTA, "v4", T0 + i)).ok).toBe(true);
    const r = await checkQuota(env.QUOTA, "v4", T0 + 5);
    expect(r).toMatchObject({ ok: false, reason: "too_fast" });
    expect((await checkQuota(env.QUOTA, "v4", T0 + 61)).ok).toBe(true);
  });

  it("charges usage to the day the request started and resets after midnight", async () => {
    const late = Date.UTC(2026, 9, 10, 23, 59, 50) / 1000;
    for (let i = 0; i < DAILY_REQUESTS - 1; i++) await recordUsage(env.QUOTA, "v5", "2026-10-10", 1);
    const check = await checkQuota(env.QUOTA, "v5", late);
    expect(check.ok).toBe(true);
    // request finishes after midnight but is charged to check.day
    if (check.ok) await recordUsage(env.QUOTA, "v5", check.day, 500);
    const blockedSameDay = await checkQuota(env.QUOTA, "v5", late + 5);
    expect(blockedSameDay).toMatchObject({ ok: false, reason: "daily_limit" });
    const nextDay = await checkQuota(env.QUOTA, "v5", late + 20);
    expect(nextDay.ok).toBe(true);
    if (nextDay.ok) expect(nextDay.remaining.requests).toBe(DAILY_REQUESTS);
  });

  it("nextUtcMidnight", () => {
    expect(nextUtcMidnight(T0)).toBe(Date.UTC(2026, 9, 11) / 1000);
  });
});
