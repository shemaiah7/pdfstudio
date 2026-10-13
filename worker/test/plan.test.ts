// worker/test/plan.test.ts
import { describe, it, expect } from "vitest";
import { planOf, TRIAL_SECONDS, GRACE_SECONDS, type UserRow } from "../src/plan";

const now = 1_800_000_000;
const base: UserRow = { id: "user_1", email: "a@b.c", created_at: now - 100, trial_ends_at: now - 100 + TRIAL_SECONDS, terms_version: null, terms_accepted_at: null, stripe_customer_id: null, subscription_status: null, current_period_end: null, past_due_since: null };
const expired = { ...base, trial_ends_at: now - 1 };

describe("planOf", () => {
  it.each([
    ["no user", null, "anon"],
    ["in trial", base, "trial"],
    ["trial over, no sub", expired, "free"],
    ["active", { ...expired, subscription_status: "active", current_period_end: now + 10 }, "pro"],
    ["stripe trialing", { ...expired, subscription_status: "trialing" }, "pro"],
    ["canceled before period end", { ...expired, subscription_status: "canceled", current_period_end: now + 10 }, "pro"],
    ["canceled after period end", { ...expired, subscription_status: "canceled", current_period_end: now - 1 }, "free"],
    ["past_due inside grace", { ...expired, subscription_status: "past_due", past_due_since: now - GRACE_SECONDS + 10 }, "pro"],
    ["past_due outside grace", { ...expired, subscription_status: "past_due", past_due_since: now - GRACE_SECONDS - 1 }, "free"],
    ["unpaid outside grace, trial still on", { ...base, subscription_status: "unpaid", past_due_since: now - GRACE_SECONDS - 1 }, "trial"],
    ["incomplete", { ...expired, subscription_status: "incomplete" }, "free"],
  ] as const)("%s → %s", (_n, user, plan) => {
    expect(planOf(user as UserRow | null, now)).toBe(plan);
  });
});
