// worker/src/plan.ts
import type { Env } from "./env";

export type Plan = "anon" | "free" | "trial" | "pro";
export const TRIAL_SECONDS = 7 * 86400;
export const GRACE_SECONDS = 3 * 86400;

export interface UserRow {
  id: string; email: string; created_at: number; trial_ends_at: number;
  terms_version: string | null; terms_accepted_at: number | null;
  stripe_customer_id: string | null; subscription_status: string | null;
  current_period_end: number | null; past_due_since: number | null;
}

/** The single entitlement rule (spec: "Entitlement rule"). */
export function planOf(user: UserRow | null, now: number): Plan {
  if (!user) return "anon";
  const s = user.subscription_status;
  if (s === "active" || s === "trialing") return "pro";
  if (s === "canceled" && user.current_period_end !== null && now < user.current_period_end) return "pro";
  if ((s === "past_due" || s === "unpaid") && user.past_due_since !== null && now < user.past_due_since + GRACE_SECONDS) return "pro";
  return now < user.trial_ends_at ? "trial" : "free";
}

export function paywallOn(env: Env): boolean { return env.PAYWALL_ENABLED === "true"; }
