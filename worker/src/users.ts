// worker/src/users.ts
import { TRIAL_SECONDS, type UserRow } from "./plan";

const COLUMNS = ["email", "created_at", "trial_ends_at", "terms_version", "terms_accepted_at", "stripe_customer_id", "subscription_status", "current_period_end", "past_due_since"] as const;

export async function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return (await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>()) ?? null;
}

export async function getUserByCustomer(db: D1Database, customerId: string): Promise<UserRow | null> {
  return (await db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").bind(customerId).first<UserRow>()) ?? null;
}

export async function ensureUser(db: D1Database, id: string, email: string, now: number): Promise<UserRow> {
  await db.prepare("INSERT INTO users (id, email, created_at, trial_ends_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
    .bind(id, email, Math.floor(now), Math.floor(now) + TRIAL_SECONDS).run();
  return (await getUser(db, id))!;
}

export async function updateUser(db: D1Database, id: string, patch: Partial<Omit<UserRow, "id">>): Promise<void> {
  const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => (COLUMNS as readonly string[]).includes(k));
  if (keys.length === 0) return;
  const sql = `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  await db.prepare(sql).bind(...keys.map((k) => patch[k] ?? null), id).run();
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}
