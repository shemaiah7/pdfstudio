import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { checkUsage, monthKey, monthWindow, voiceAllowance, addVoiceMonth, LIMITS, TOKEN_DAY, GATED_BURST } from "../src/limits";

const t0 = Date.UTC(2026, 9, 12, 12) / 1000;
const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m, d, h) / 1000;
let n = 0; const sub = () => `u:lim${++n}`;
const cal = (now = t0) => monthWindow("free", null, now);

describe("limits", () => {
  it("free: 5 AI per day, then daily_limit with next UTC midnight", async () => {
    const s = sub(), mw = cal();
    for (let i = 0; i < 5; i++) expect((await checkUsage(env.QUOTA, s, "free", "ai", 1, mw, t0 + i * 60)).ok).toBe(true);
    const r = await checkUsage(env.QUOTA, s, "free", "ai", 1, mw, t0 + 600);
    expect(r).toMatchObject({ ok: false, error: "daily_limit", scope: "day", resetAt: Date.UTC(2026, 9, 13) / 1000 });
  });
  it("free: Deep OCR is pro_required", async () => {
    expect(await checkUsage(env.QUOTA, sub(), "free", "ocr", 1, cal(), t0)).toMatchObject({ ok: false, error: "pro_required" });
  });
  it("pro: monthly cap across days resets at the window end", async () => {
    const s = sub(), mw = monthWindow("pro", t0 + 20 * 86400, t0);
    await env.QUOTA.put(`m:ai:${s}:${mw.key}`, String(LIMITS.pro.aiMonth - 1));
    expect((await checkUsage(env.QUOTA, s, "pro", "ai", 1, mw, t0)).ok).toBe(true);
    expect(await checkUsage(env.QUOTA, s, "pro", "ai", 1, mw, t0 + 60)).toMatchObject({ ok: false, error: "monthly_limit", scope: "month", resetAt: t0 + 20 * 86400 });
  });
  it("ocr batch weight counts pages", async () => {
    const s = sub();
    expect(await checkUsage(env.QUOTA, s, "pro", "ocr", 301, cal(), t0)).toMatchObject({ ok: false, error: "monthly_limit" });
    expect((await checkUsage(env.QUOTA, s, "pro", "ocr", 300, cal(), t0)).ok).toBe(true);
  });
  it("remaining.requests is the day remainder, or the month remainder when smaller", async () => {
    const s = sub();
    expect(await checkUsage(env.QUOTA, s, "trial", "ai", 1, cal(), t0)).toMatchObject({ ok: true, remaining: { requests: 99 } });
    const s2 = sub();
    await env.QUOTA.put(`m:ai:${s2}:${cal().key}`, String(LIMITS.trial.aiMonth - 10));
    expect(await checkUsage(env.QUOTA, s2, "trial", "ai", 1, cal(), t0)).toMatchObject({ ok: true, remaining: { requests: 9 } });
    expect(await checkUsage(env.QUOTA, sub(), "pro", "ocr", 5, cal(), t0)).toMatchObject({ ok: true, remaining: { requests: 295 } });
  });
  it("daily token ceiling per plan -> daily_limit scope day", async () => {
    expect(TOKEN_DAY).toEqual({ free: 100_000, trial: 1_000_000, pro: 2_000_000 });
    const s = sub(), day = new Date(t0 * 1000).toISOString().slice(0, 10);
    await env.QUOTA.put(`q:${s}:${day}`, JSON.stringify({ requests: 0, tokens: 100_000 }));
    expect(await checkUsage(env.QUOTA, s, "free", "ai", 1, cal(), t0)).toMatchObject({ ok: false, error: "daily_limit", scope: "day", resetAt: Date.UTC(2026, 9, 13) / 1000 });
    expect((await checkUsage(env.QUOTA, s, "trial", "ai", 1, cal(), t0)).ok).toBe(true);
  });
  it("charges the input-token estimate at admission", async () => {
    const s = sub(), day = new Date(t0 * 1000).toISOString().slice(0, 10);
    const r = await checkUsage(env.QUOTA, s, "pro", "ai", 1, cal(), t0, 1234);
    expect(r).toMatchObject({ ok: true, remaining: { tokens: 2_000_000 - 1234 } });
    expect(await env.QUOTA.get(`q:${s}:${day}`, "json")).toEqual({ requests: 0, tokens: 1234 });
  });
  it(`burst: more than ${GATED_BURST} requests in a minute -> too_fast`, async () => {
    const s = sub();
    for (let i = 0; i < GATED_BURST; i++) expect((await checkUsage(env.QUOTA, s, "pro", "ai", 1, cal(), t0)).ok).toBe(true);
    const r = await checkUsage(env.QUOTA, s, "pro", "ai", 1, cal(), t0);
    expect(r).toMatchObject({ ok: false, error: "too_fast", resetAt: (Math.floor(t0 / 60) + 1) * 60 });
    expect((await checkUsage(env.QUOTA, s, "pro", "ai", 1, cal(), t0 + 60)).ok).toBe(true);
  });
  it("voice allowance is the smaller of day cap and month remainder", async () => {
    const s = sub();
    expect(await voiceAllowance(env.QUOTA, s, "pro", "2026-10", t0)).toBe(1800);
    await addVoiceMonth(env.QUOTA, s, "2026-10", 7200 - 600);
    expect(await voiceAllowance(env.QUOTA, s, "pro", "2026-10", t0)).toBe(600);
  });
  it("monthKey: calendar month for trial/free and for pro without a period end", () => {
    expect(monthKey("trial", null, t0)).toBe("2026-10");
    expect(monthKey("pro", null, t0)).toBe("2026-10");
    expect(monthWindow("free", null, t0).resetAt).toBe(Date.UTC(2026, 10, 1) / 1000);
  });
  it("monthly Pro: the window is the billing period (anchor one month before period end)", () => {
    const end = at(2026, 10, 3); // Nov 3
    expect(monthWindow("pro", end, t0)).toEqual({ key: `p${at(2026, 9, 3)}`, resetAt: end });
  });
  it("yearly Pro: period end 11 months out -> a window within the current month", () => {
    const end = at(2027, 8, 3); // Sep 3 2027
    const w = monthWindow("pro", end, t0); // now Oct 12 2026
    expect(w).toEqual({ key: `p${at(2026, 9, 3)}`, resetAt: at(2026, 10, 3) });
    expect(monthWindow("pro", end, at(2026, 10, 3)).key).toBe(`p${at(2026, 10, 3)}`); // rolls over at the anchor
  });
  it("yearly Pro on the 31st clamps to short months", () => {
    const end = at(2027, 0, 31); // Jan 31 2027
    expect(monthWindow("pro", end, at(2026, 10, 15))).toEqual({ key: `p${at(2026, 9, 31)}`, resetAt: at(2026, 10, 30) }); // Oct 31 -> Nov 30
    expect(monthWindow("pro", end, at(2026, 11, 5))).toEqual({ key: `p${at(2026, 10, 30)}`, resetAt: at(2026, 11, 31) }); // Nov 30 -> Dec 31
    expect(monthWindow("pro", at(2027, 2, 31), at(2027, 1, 10))).toEqual({ key: `p${at(2027, 0, 31)}`, resetAt: at(2027, 1, 28) }); // Jan 31 -> Feb 28
  });
  it("Pro whose period end has passed (grace) steps forward to the current window", () => {
    expect(monthWindow("pro", at(2026, 8, 3), t0)).toEqual({ key: `p${at(2026, 9, 3)}`, resetAt: at(2026, 10, 3) });
  });
});
