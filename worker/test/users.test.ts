// worker/test/users.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { ensureUser, getUser, getUserByCustomer, updateUser, deleteUser } from "../src/users";
import { TRIAL_SECONDS } from "../src/plan";

describe("users repo", () => {
  it("ensureUser inserts once and never resets the trial", async () => {
    const a = await ensureUser(env.DB, "user_r1", "x@y.z", 1000);
    expect(a.trial_ends_at).toBe(1000 + TRIAL_SECONDS);
    const b = await ensureUser(env.DB, "user_r1", "changed@y.z", 5000);
    expect(b.trial_ends_at).toBe(1000 + TRIAL_SECONDS);
    expect(b.created_at).toBe(1000);
  });
  it("update, lookup by customer, delete", async () => {
    await ensureUser(env.DB, "user_r2", "q@y.z", 1000);
    await updateUser(env.DB, "user_r2", { stripe_customer_id: "cus_9", subscription_status: "active" });
    expect((await getUserByCustomer(env.DB, "cus_9"))?.id).toBe("user_r2");
    await deleteUser(env.DB, "user_r2");
    expect(await getUser(env.DB, "user_r2")).toBeNull();
  });
  it("updateUser ignores unknown keys (no SQL injection through column names)", async () => {
    await ensureUser(env.DB, "user_r3", "q@y.z", 1000);
    await updateUser(env.DB, "user_r3", { ["email = 'x'; --" as "email"]: "bad" } as never);
    expect((await getUser(env.DB, "user_r3"))?.email).toBe("q@y.z");
  });
});
