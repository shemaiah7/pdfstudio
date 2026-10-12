import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { admitVoice, chargeVoice, reconcileVoice, readVoice, ADMISSION_SECONDS } from "../src/voiceQuota";

const day = new Date().toISOString().slice(0, 10);
let n = 0; const vid = () => `v${++n}`;

describe("voice quota", () => {
  it("admits a fresh visitor and reports the day", async () => {
    const r = await admitVoice(env.QUOTA, vid(), 1800);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.day).toBe(day); expect(r.state).toEqual({ seconds: 0, charged: {} }); expect(r.resetAt).toBeGreaterThan(Date.now() / 1000); }
  });
  it("refuses when the admission charge would exceed the limit", async () => {
    const v = vid();
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 1300, charged: { a: 1300 } }));
    const r = await admitVoice(env.QUOTA, v, 1800);
    expect(r).toMatchObject({ ok: false });
    expect(await readVoice(env.QUOTA, v, day)).toMatchObject({ seconds: 1300 });
  });
  it("charges the admission and sums charged entries", async () => {
    const v = vid();
    const s1 = await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS);
    expect(s1).toEqual({ seconds: 600, charged: { c1: 600 } });
    const s2 = await chargeVoice(env.QUOTA, v, day, "c2", ADMISSION_SECONDS);
    expect(s2.seconds).toBe(1200);
    expect(await env.QUOTA.get(`v:${v}:${day}`, "json")).toEqual(s2);
  });
  it("reconciles to the actual duration with a 15 s floor, idempotently", async () => {
    const v = vid();
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95)).toEqual({ seconds: 95, charged: { c1: 95 } });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95)).toEqual({ seconds: 95, charged: { c1: 95 } });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0)).toEqual({ seconds: 15, charged: { c1: 15 } });
  });
  it("returns null for a conversation that was never charged", async () => {
    expect(await reconcileVoice(env.QUOTA, vid(), day, "ghost", 10)).toBeNull();
  });
});
