import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { admitVoice, chargeVoice, reconcileVoice, readVoice, ADMISSION_SECONDS, SETTLE_WINDOW_S } from "../src/voiceQuota";

const day = new Date().toISOString().slice(0, 10);
let n = 0; const vid = () => `v${++n}`;

describe("voice quota", () => {
  it("admits a fresh visitor and reports the day", async () => {
    const r = await admitVoice(env.QUOTA, vid(), 1800);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.day).toBe(day); expect(r.state).toEqual({ seconds: 0, charged: {}, admitted: {}, pending: {}, verified: {} }); expect(r.resetAt).toBeGreaterThan(Date.now() / 1000); }
  });
  it("refuses when the admission charge would exceed the limit", async () => {
    const v = vid();
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 1300, charged: { a: 1300 } }));
    const r = await admitVoice(env.QUOTA, v, 1800);
    expect(r).toMatchObject({ ok: false });
    expect(await readVoice(env.QUOTA, v, day)).toMatchObject({ seconds: 1300 });
  });
  it("a smaller minReserve admits into a short allowance and reserves what is left", async () => {
    const v = vid();
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 100, charged: { a: 100 } }));
    expect(await admitVoice(env.QUOTA, v, 300)).toMatchObject({ ok: false });
    expect(await admitVoice(env.QUOTA, v, 300, Date.now() / 1000, 60)).toMatchObject({ ok: true, reserve: 200 });
    expect(await admitVoice(env.QUOTA, v, 1800)).toMatchObject({ ok: true, reserve: 600 });
    expect(await admitVoice(env.QUOTA, v, 150, Date.now() / 1000, 60)).toMatchObject({ ok: false });
  });
  it("reconcile reports the change in the conversation's charge", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    await chargeVoice(env.QUOTA, v, day, "c1", 300, t);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95, t, true)).toMatchObject({ delta: -205 });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95, t, true)).toMatchObject({ delta: 0 });
  });
  it("charges the admission, records admitted[id] and sums charged entries", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    const s1 = await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS, t);
    expect(s1).toEqual({ seconds: 600, charged: { c1: 600 }, admitted: { c1: t }, pending: {}, verified: {} });
    const s2 = await chargeVoice(env.QUOTA, v, day, "c2", ADMISSION_SECONDS, t);
    expect(s2.seconds).toBe(1200);
    expect(await env.QUOTA.get(`v:${v}:${day}`, "json")).toEqual(s2);
  });
  it("applies a verified duration immediately with a 15 s floor, idempotently", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS, t);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95, t, true)).toMatchObject({ seconds: 95, charged: { c1: 95 } });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95, t, true)).toMatchObject({ seconds: 95, charged: { c1: 95 } });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0, t, true)).toMatchObject({ seconds: 15, charged: { c1: 15 } });
  });
  it("defers an unverified report inside the session window", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS, t);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0, t + 100, false)).toMatchObject({ seconds: 600, charged: { c1: 600 }, pending: { c1: 0 } });
  });
  it("applies an unverified report after the session window", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS, t);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0, t + SETTLE_WINDOW_S + 1, false)).toMatchObject({ seconds: 15, charged: { c1: 15 }, pending: {} });
  });
  it("keeps deferring an unverified report past the old 600 s window", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS, t);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0, t + 601, false)).toMatchObject({ seconds: 600, charged: { c1: 600 }, pending: { c1: 0 } });
  });
  it("admitVoice settles a pending report whose window has passed and persists it", async () => {
    const v = vid();
    const now = Date.now() / 1000;
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 600, charged: { c1: 600 }, admitted: { c1: now - (SETTLE_WINDOW_S + 100) }, pending: { c1: 40 } }));
    const r = await admitVoice(env.QUOTA, v, 1800, now);
    expect(r.ok).toBe(true);
    expect(await env.QUOTA.get(`v:${v}:${day}`, "json")).toMatchObject({ seconds: 40, charged: { c1: 40 }, pending: {} });
  });
  it("keeps a verified charge when an unverified report arrives after the window", async () => {
    const v = vid();
    const t = Date.now() / 1000;
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS, t);
    await reconcileVoice(env.QUOTA, v, day, "c1", 95, t, true);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0, t + 700, false)).toMatchObject({ seconds: 95, charged: { c1: 95 }, verified: { c1: true } });
    expect(await readVoice(env.QUOTA, v, day)).toMatchObject({ seconds: 95 });
  });
  it("drops a pending entry for a verified id at admission", async () => {
    const v = vid();
    const now = Date.now() / 1000;
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 95, charged: { c1: 95 }, admitted: { c1: now - (SETTLE_WINDOW_S + 100) }, pending: { c1: 0 }, verified: { c1: true } }));
    const r = await admitVoice(env.QUOTA, v, 1800, now);
    expect(r.ok).toBe(true);
    expect(await env.QUOTA.get(`v:${v}:${day}`, "json")).toMatchObject({ seconds: 95, charged: { c1: 95 }, pending: {} });
  });
  it("resetAt points at the pending settlement that makes room", async () => {
    const v = vid();
    // Noon UTC on the test's day: resetAt is the earlier of the settlement and midnight, so a real clock
    // within SETTLE_WINDOW_S of midnight would make this test expect the wrong one.
    const now = Date.parse(`${day}T12:00:00Z`) / 1000;
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 1800, charged: { a: 600, b: 600, c: 600 }, admitted: { a: now - 100, b: now - 90, c: now - 80 }, pending: { a: 30 } }));
    const r = await admitVoice(env.QUOTA, v, 2000, now);
    expect(r).toEqual({ ok: false, resetAt: now - 100 + SETTLE_WINDOW_S });
  });
  it("returns null for a conversation that was never charged", async () => {
    expect(await reconcileVoice(env.QUOTA, vid(), day, "ghost", 10)).toBeNull();
  });
  it("does not match inherited property names as charged conversations", async () => {
    expect(await reconcileVoice(env.QUOTA, vid(), day, "constructor", 10)).toBeNull();
  });
});
