import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { checkUsage, monthKey, voiceAllowance, addVoiceMonth, LIMITS } from "../src/limits";

const t0 = Date.UTC(2026, 9, 12, 12) / 1000;
let n = 0; const sub = () => `u:lim${++n}`;

describe("limits", () => {
  it("free: 5 AI per day, then daily_limit with next UTC midnight", async () => {
    const s = sub(), mk = monthKey("free", null, t0);
    for (let i = 0; i < 5; i++) expect((await checkUsage(env.QUOTA, s, "free", "ai", 1, mk, t0)).ok).toBe(true);
    const r = await checkUsage(env.QUOTA, s, "free", "ai", 1, mk, t0);
    expect(r).toMatchObject({ ok: false, error: "daily_limit", scope: "day", resetAt: Date.UTC(2026, 9, 13) / 1000 });
  });
  it("free: Deep OCR is pro_required", async () => {
    expect(await checkUsage(env.QUOTA, sub(), "free", "ocr", 1, "2026-10", t0)).toMatchObject({ ok: false, error: "pro_required" });
  });
  it("pro: monthly cap across days", async () => {
    const s = sub(), mk = monthKey("pro", t0 + 20 * 86400, t0);
    await env.QUOTA.put(`m:ai:${s}:${mk}`, String(LIMITS.pro.aiMonth - 1));
    expect((await checkUsage(env.QUOTA, s, "pro", "ai", 1, mk, t0)).ok).toBe(true);
    expect(await checkUsage(env.QUOTA, s, "pro", "ai", 1, mk, t0)).toMatchObject({ ok: false, error: "monthly_limit", scope: "month", resetAt: t0 + 20 * 86400 });
  });
  it("ocr batch weight counts pages", async () => {
    const s = sub();
    expect(await checkUsage(env.QUOTA, s, "pro", "ocr", 301, "2026-10", t0)).toMatchObject({ ok: false, error: "monthly_limit" });
    expect((await checkUsage(env.QUOTA, s, "pro", "ocr", 300, "2026-10", t0)).ok).toBe(true);
  });
  it("voice allowance is the smaller of day cap and month remainder", async () => {
    const s = sub();
    expect(await voiceAllowance(env.QUOTA, s, "pro", "2026-10", t0)).toBe(1800);
    await addVoiceMonth(env.QUOTA, s, "2026-10", 7200 - 600);
    expect(await voiceAllowance(env.QUOTA, s, "pro", "2026-10", t0)).toBe(600);
  });
  it("monthKey: calendar month for trial/free, period end for pro", () => {
    expect(monthKey("trial", null, t0)).toBe("2026-10");
    expect(monthKey("pro", 1_900_000_000, t0)).toBe("p1900000000");
    expect(monthKey("pro", null, t0)).toBe("2026-10");
  });
});
