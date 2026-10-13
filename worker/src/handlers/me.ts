import type { Env } from "../env";
import { json } from "../cors";
import { verifySession, sessionPlan, utcDay, type SessionPayload } from "../session";
import { getUser, updateUser, deleteUser } from "../users";
import { planOf, paywallOn } from "../plan";
import { LIMITS, monthKey } from "../limits";
import { readVoice } from "../voiceQuota";
import { TERMS_VERSION } from "../terms";
import { deleteClerkUser } from "../clerk";
import { cancelCustomerSubscriptions } from "../stripe";

export interface MeDeps { cancelSubscription(customerId: string, env: Env): Promise<void>; deleteClerkUser(id: string, env: Env): Promise<void> }
const deps: MeDeps = { cancelSubscription: cancelCustomerSubscriptions, deleteClerkUser: (id, env) => deleteClerkUser(id, env) };
export function configureMeDeps(p: Partial<MeDeps>): void { Object.assign(deps, p); }

async function authed(request: Request, env: Env): Promise<SessionPayload | null> {
  const a = request.headers.get("authorization") ?? "";
  return a.startsWith("Bearer ") ? verifySession(a.slice(7), env.SESSION_SECRET) : null;
}
const n = async (kv: KVNamespace, k: string) => Number((await kv.get(k)) ?? "0");

export async function meHandler(request: Request, env: Env): Promise<Response> {
  const s = await authed(request, env);
  if (!s) return json({ error: "unauthorized" }, 401, env);
  if (sessionPlan(s) === "anon" || !s.uid) return json({ plan: "anon", paywall: paywallOn(env) }, 200, env);
  const now = Date.now() / 1000;
  let user;
  try { user = await getUser(env.DB, s.uid); } catch { return json({ error: "account_unavailable" }, 503, env); }
  if (!user) return json({ error: "unauthorized" }, 401, env);
  const plan = planOf(user, now);
  if (plan === "anon") return json({ plan: "anon", paywall: paywallOn(env) }, 200, env);
  const mk = monthKey(plan, user.current_period_end, now), day = utcDay(now);
  const usage = {
    aiDay: await n(env.QUOTA, `d:ai:${s.vid}:${day}`), aiMonth: await n(env.QUOTA, `m:ai:${s.vid}:${mk}`),
    voiceDaySec: (await readVoice(env.QUOTA, s.vid, day)).seconds, voiceMonthSec: await n(env.QUOTA, `m:voice:${s.vid}:${mk}`),
    ocrMonth: await n(env.QUOTA, `m:ocr:${s.vid}:${mk}`),
  };
  return json({ plan, trialEndsAt: user.trial_ends_at, periodEnd: user.current_period_end, status: user.subscription_status, termsAccepted: user.terms_version === TERMS_VERSION, termsVersion: TERMS_VERSION, paywall: paywallOn(env), usage, limits: LIMITS[plan] }, 200, env);
}

export async function termsHandler(request: Request, env: Env): Promise<Response> {
  const s = await authed(request, env);
  if (!s?.uid) return json({ error: "unauthorized" }, 401, env);
  let version: unknown;
  try { version = ((await request.json()) as { version?: unknown }).version; } catch { /* invalid */ }
  if (version !== TERMS_VERSION) return json({ error: "terms_version" }, 400, env);
  try { await updateUser(env.DB, s.uid, { terms_version: TERMS_VERSION, terms_accepted_at: Math.floor(Date.now() / 1000) }); } catch { return json({ error: "account_unavailable" }, 503, env); }
  return json({ ok: true }, 200, env);
}

async function purgeCounters(kv: KVNamespace, vid: string): Promise<void> {
  for (const base of ["d:ai", "d:ocr", "m:ai", "m:ocr", "m:voice", "v", "q", "b"]) {
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix: `${base}:${vid}:`, cursor });
      for (const k of page.keys) await kv.delete(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
}

export async function deleteAccountHandler(request: Request, env: Env): Promise<Response> {
  const s = await authed(request, env);
  if (!s?.uid) return json({ error: "unauthorized" }, 401, env);
  const uid = s.uid;
  const fail = (step: string) => { console.log(JSON.stringify({ task: "account_delete", uid, step, status: "error" })); return json({ error: "account_unavailable" }, 503, env); };
  let user;
  try { user = await getUser(env.DB, uid); } catch { return fail("lookup"); }
  if (user?.stripe_customer_id) {
    try { await deps.cancelSubscription(user.stripe_customer_id, env); } catch { return fail("stripe"); }
  }
  try { await purgeCounters(env.QUOTA, `u:${uid}`); } catch { console.log(JSON.stringify({ task: "account_delete", uid, step: "kv", status: "error" })); }
  try { await deleteUser(env.DB, uid); } catch { return fail("d1"); }
  try { await deps.deleteClerkUser(uid, env); } catch { return fail("clerk"); }
  return json({ ok: true }, 200, env);
}
