# Accounts and Subscription Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sign-in (Clerk), a 7-day trial, one Pro plan billed by Stripe, and per-plan gates and limits to PDF Studio, shipped behind a `PAYWALL_ENABLED` flag.

**Architecture:** The AI Worker (`worker/`) becomes the source of truth.
- It verifies Clerk session JWTs with WebCrypto and keeps users in a new D1 database.
- It derives the plan with one pure function, and puts `plan` into its existing HMAC session token.
- It enforces per-plan limits on `/ai`, `/ocr` and `/live`.
- It talks to Stripe over its REST API with `fetch`, and handles Stripe webhooks.

The app (`src/`) wraps itself in Clerk, sends the Clerk token to `/session`, and keeps a `useAccount` store fed by `/me`. It gates editing on the client and adds the account, terms, upgrade and paywall screens.

**Tech Stack:**
- Cloudflare Workers, D1, KV and `@cloudflare/vitest-plugin`.
- WebCrypto (RS256 JWT and HMAC-SHA256), Stripe REST API v1, Clerk Backend API v1.
- React 19, zustand and `@clerk/clerk-react`, with Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-subscription-funnel-design.md`

## Global Constraints

- **Tiers:**
  - Anonymous: view only.
  - Free account after trial: 5 AI requests/day, 5 voice min/day, no Deep OCR, no editing.
  - Trial (7 days from account creation) and Pro: editing, 1,000 AI requests/month (max 100/day), 120 voice min/month (max 30/day), 300 Deep OCR pages/month.
- **Price:** Pro $29/month or $249/year. Stripe price ids come from Worker vars `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`. The client never sends an amount.
- **Entitlement:**
  - `pro` if status is `active` or `trialing`;
  - `pro` if `canceled` and `now < current_period_end`;
  - `pro` if `past_due` / `unpaid` and `now < past_due_since + 3 days`;
  - else `trial` if `now < trial_ends_at`;
  - else `free`.
- **Session tokens** issued for signed-in users expire after **600 s**.
- **Windows:** day windows reset at UTC midnight. The month window is the Stripe billing period for Pro, keyed by `current_period_end`, and the UTC calendar month otherwise.
- **Flag:** `PAYWALL_ENABLED` (Worker var `"true"`/`"false"`, default `"false"`) and `VITE_PAYWALL_ENABLED` (app build var). With the flag off, nothing is locked and every caller, signed in or not, gets today's anonymous quotas.
- **Terms:** current terms version constant `TERMS_VERSION = "2026-10-12"` lives in `worker/src/terms.ts` and `src/account/terms.ts` (same value).
- **Terms checkbox copy** (verbatim): "I understand PDF Studio is a general documentation tool, I won't upload identifiable patient information, and I use it at my own risk."
- **D1 failures** fail closed for paid features: 503 `account_unavailable`.
- **Offline plan cache:** `localStorage` key `pdfstudio.account`, honoured for 7 days. Every storage access is wrapped in try/catch.
- **Work in git worktrees** off `origin/main`. Never switch or leave edits in the shared checkout `/Volumes/MelaninServer/pdfstudio`. Use `ONNXRUNTIME_NODE_INSTALL=skip npm ci`.
- **No new dependencies** except `@clerk/clerk-react` in the app. The Worker uses `fetch` and WebCrypto only.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A Stripe webhook arriving before the user's D1 row exists** (checkout completed in another tab while sign-in is still writing the row): it must not be lost. Covered by Task 7 "webhook for unknown customer creates/links via client_reference_id".
2. **The same Stripe event delivered twice, or out of order** (`subscription.updated` before `checkout.session.completed`): it is applied once, and the final state reflects the latest subscription object. Covered by Task 7 idempotency and ordering tests.
3. **A cancelled Pro user after `current_period_end`, and an installed app offline with a stale cached `pro`:** the server must drop to `trial`/`free` at period end. The client cache must expire after 7 days and must never override a fresh `/me`. Covered by Task 2 (table) and Task 9 (cache expiry, fresh-wins).
4. **A Clerk JWT that is expired, has the wrong issuer, is signed by an unknown `kid`, or uses `alg: none`/HS256:** all must be rejected with 401, never fall through to anonymous Pro. Covered by Task 3.
5. **The flag flipped on while signed-in sessions hold old 24 h anonymous-style tokens:** old tokens without `plan` must be treated as `anon`, not `pro`. Covered by Task 3 "legacy token defaults to anon" and Task 4 "anon blocked when flag on".

---

## File Structure

**Worker (`worker/`):**

| File | Status | Responsibility |
|---|---|---|
| `migrations/0001_accounts.sql` | create | D1 schema: `users`, `stripe_events` |
| `wrangler.jsonc` | modify | D1 binding `DB`, `migrations_dir`, vars `PAYWALL_ENABLED`, `CLERK_ISSUER`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `APP_URL` |
| `vitest.config.ts` | modify | D1 + migrations + test bindings |
| `test/apply-migrations.ts` | create | Vitest setup file applying D1 migrations |
| `src/env.ts` | modify | New bindings/secrets on `Env` |
| `src/plan.ts` | create | `Plan` type, `planOf(user, now)`, `paywallOn(env)` |
| `src/users.ts` | create | D1 data access for `users` |
| `src/clerk.ts` | create | Clerk JWT verification (JWKS, RS256) and Backend API (get/delete user) |
| `src/session.ts` | modify | `SessionPayload` gains optional `plan`, `uid` |
| `src/handlers/session.ts` | modify | Accept a Clerk JWT; create the user row; issue a plan token |
| `src/limits.ts` | create | Per-plan day/month counters for AI, OCR and voice |
| `src/handlers/ai.ts`, `ocr.ts`, `live.ts` | modify | Use `limits.ts` when the flag is on |
| `src/voiceQuota.ts` | modify | Optional monthly voice counter hook |
| `src/handlers/me.ts` | create | `/me`, `/terms/accept`, `/account/delete` |
| `src/terms.ts` | create | `TERMS_VERSION` |
| `src/stripe.ts` | create | Stripe REST helpers and webhook signature verification |
| `src/handlers/billing.ts` | create | `/billing/checkout`, `/billing/portal`, `/billing/webhook` |
| `src/index.ts` | modify | Routes; webhook exempt from CORS preflight logic |

**App (`src/`):**

| File | Status | Responsibility |
|---|---|---|
| `.env.production` | modify | `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_PAYWALL_ENABLED` |
| `vite.config.ts` | modify | Prod-env guard adds `VITE_CLERK_PUBLISHABLE_KEY` |
| `src/account/terms.ts` | create | `TERMS_VERSION`, terms copy |
| `src/account/store.ts` | create | `useAccount` zustand store, `/me` fetch, 7-day cache |
| `src/account/capabilities.ts` | create | `can(plan, feature)` pure helper + `paywallEnabled()` |
| `src/ai/client.ts` | modify | Bearer Clerk token to `/session`; `me()`, `acceptTerms()`, `checkout()`, `portal()`, `deleteAccount()` |
| `src/components/account/*.tsx` | create | AccountMenu, TrialPill, TermsDialog, UpgradeSheet, PaywallSheet, ActivatingNotice, RolloutBanner |
| `src/main.tsx` | modify | `ClerkProvider` |
| `src/components/ToolPalette.tsx`, `Toolbar.tsx`, `FormLayer.tsx`, `live/VoiceTab.tsx`, `ai/AiPanel.tsx`, `ocr/DeepOcrMenu.tsx` | modify | Gates |
| `e2e/account.spec.ts` | create | Mocked `/session` + `/me` per plan |

---

### Task 1: D1 database, migration and test harness

**Files:**
- Create: `worker/migrations/0001_accounts.sql`, `worker/test/apply-migrations.ts`
- Modify: `worker/wrangler.jsonc`, `worker/vitest.config.ts`, `worker/src/env.ts`
- Test: `worker/test/d1.test.ts`

**Interfaces:**
- Produces: `env.DB: D1Database`; tables `users`, `stripe_events`; `Env` fields `DB`, `PAYWALL_ENABLED?`, `CLERK_ISSUER`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `APP_URL`.

- [ ] **Step 1: Write the migration**

```sql
-- worker/migrations/0001_accounts.sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL,
  terms_version TEXT,
  terms_accepted_at INTEGER,
  stripe_customer_id TEXT UNIQUE,
  subscription_status TEXT,
  current_period_end INTEGER,
  past_due_since INTEGER
);
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
```

- [ ] **Step 2: Wire D1 into wrangler and vitest**

`worker/wrangler.jsonc`: add after `kv_namespaces`:

```jsonc
  "d1_databases": [{ "binding": "DB", "database_name": "pdfstudio", "database_id": "REPLACE_WITH_ID_FROM_wrangler_d1_create", "migrations_dir": "migrations" }],
```

…and add to `vars`: `"PAYWALL_ENABLED": "false"`, `"CLERK_ISSUER": ""`, `"STRIPE_PRICE_MONTHLY": ""`, `"STRIPE_PRICE_YEARLY": ""`, `"APP_URL": "https://pdfstudio.shemaiah7.workers.dev"`.

The `database_id` is filled in during owner setup (Task 13). Empty vars are filled in at the same time.

`worker/vitest.config.ts`:

```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { join } from "node:path";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(join(__dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          kvNamespaces: ["QUOTA"],
          d1Databases: ["DB"],
          bindings: {
            ANTHROPIC_API_KEY: "test-key",
            TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
            SESSION_SECRET: "test-session-secret",
            ALLOWED_ORIGIN: "http://localhost:5173,http://localhost:5175",
            TURNSTILE_HOSTNAMES: "localhost",
            ELEVENLABS_API_KEY: "el-test-key",
            ELEVENLABS_AGENT_ID: "agent_test",
            VOICE_DAILY_SECONDS: "1800",
            PAYWALL_ENABLED: "false",
            CLERK_ISSUER: "https://clerk.test",
            CLERK_SECRET_KEY: "sk_test_clerk",
            STRIPE_SECRET_KEY: "sk_test_stripe",
            STRIPE_WEBHOOK_SECRET: "whsec_test",
            STRIPE_PRICE_MONTHLY: "price_month",
            STRIPE_PRICE_YEARLY: "price_year",
            APP_URL: "http://localhost:5173",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
  };
});
```

`worker/test/apply-migrations.ts`:

```ts
import { applyD1Migrations, env } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Add `TEST_MIGRATIONS: D1Migration[]` to `worker/test/env.d.ts`'s `ProvidedEnv`, extending `Env`.

`worker/src/env.ts` — add fields:

```ts
  DB: D1Database;
  PAYWALL_ENABLED?: string;       // "true" turns on gates and per-plan limits
  CLERK_ISSUER: string;           // e.g. https://<instance>.clerk.accounts.dev
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_MONTHLY: string;
  STRIPE_PRICE_YEARLY: string;
  APP_URL: string;
```

- [ ] **Step 3: Write the failing test**

```ts
// worker/test/d1.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("D1 schema", () => {
  it("has users and stripe_events", async () => {
    const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>();
    expect(r.results.map((x) => x.name)).toEqual(expect.arrayContaining(["users", "stripe_events"]));
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd worker && npx vitest run test/d1.test.ts`
Expected: PASS. If the harness isn't wired yet, it fails with "no such table". Fix the wiring until it passes.

- [ ] **Step 5: Run the whole worker suite, typecheck, commit**

Run: `cd worker && npx vitest run && npm run typecheck`
Expected: all pass (108 existing + 1).

```bash
git add worker/migrations worker/test/apply-migrations.ts worker/test/d1.test.ts worker/test/env.d.ts worker/vitest.config.ts worker/wrangler.jsonc worker/src/env.ts
git commit -m "feat(worker): D1 accounts schema and test harness"
```

---

### Task 2: Plan rule and users repository

**Files:**
- Create: `worker/src/plan.ts`, `worker/src/users.ts`
- Test: `worker/test/plan.test.ts`, `worker/test/users.test.ts`

**Interfaces:**
- Consumes: `env.DB` (Task 1).
- Produces:
  - `type Plan = "anon" | "free" | "trial" | "pro"`
  - `interface UserRow { id: string; email: string; created_at: number; trial_ends_at: number; terms_version: string | null; terms_accepted_at: number | null; stripe_customer_id: string | null; subscription_status: string | null; current_period_end: number | null; past_due_since: number | null }`
  - `planOf(user: UserRow | null, now: number): Plan`
  - `paywallOn(env: Env): boolean`
  - `TRIAL_SECONDS = 7 * 86400`, `GRACE_SECONDS = 3 * 86400`
  - `getUser(db, id): Promise<UserRow | null>`
  - `ensureUser(db, id, email, now): Promise<UserRow>` (inserts if missing; never resets the trial)
  - `getUserByCustomer(db, customerId): Promise<UserRow | null>`
  - `updateUser(db, id, patch: Partial<Omit<UserRow, "id">>): Promise<void>`
  - `deleteUser(db, id): Promise<void>`

- [ ] **Step 1: Write the failing plan table test**

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd worker && npx vitest run test/plan.test.ts`. Expected: FAIL, "Cannot find module '../src/plan'".

- [ ] **Step 3: Implement `plan.ts`**

```ts
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
```

- [ ] **Step 4: Run plan test → PASS**

- [ ] **Step 5: Write the failing users repo test**

```ts
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
```

- [ ] **Step 6: Implement `users.ts`**

```ts
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
```

- [ ] **Step 7: Run both tests → PASS; full worker suite + typecheck; commit**

```bash
git add worker/src/plan.ts worker/src/users.ts worker/test/plan.test.ts worker/test/users.test.ts
git commit -m "feat(worker): plan entitlement rule and users repository"
```

---

### Task 3: Clerk JWT verification and plan-aware `/session`

**Files:**
- Create: `worker/src/clerk.ts`
- Modify: `worker/src/session.ts`, `worker/src/handlers/session.ts`
- Test: `worker/test/clerk.test.ts`, `worker/test/session.test.ts` (extend)

**Interfaces:**
- Consumes: `planOf`, `paywallOn` (Task 2); `ensureUser`, `getUser` (Task 2).
- Produces:
  - `SessionPayload { vid: string; exp: number; plan?: Plan; uid?: string }`. `vid` is the quota key: the IP-hash for anonymous visitors, `u:<clerkId>` for users. A missing `plan` means `"anon"`.
  - `sessionPlan(s: SessionPayload): Plan`
  - `verifyClerkJwt(token: string, env: Env, now?: number, fetchFn?: typeof fetch): Promise<{ sub: string } | null>`
  - `clerkUserEmail(id: string, env: Env, fetchFn?: typeof fetch): Promise<string>`
  - `deleteClerkUser(id: string, env: Env, fetchFn?: typeof fetch): Promise<void>`
  - `setJwksForTest(keys: JsonWebKey[] | null): void`
  - `/session` request body: `{ turnstileToken }` (anonymous) **or** header `Authorization: Bearer <clerk JWT>`. Response `{ token, expiresAt, plan }`.

- [ ] **Step 1: Write the failing Clerk test with a local RS256 key pair**

```ts
// worker/test/clerk.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { verifyClerkJwt, setJwksForTest } from "../src/clerk";

const b64u = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let priv: CryptoKey;
async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) {
  const h = b64u(JSON.stringify(header)), p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const now = Math.floor(Date.now() / 1000);
const good = () => ({ sub: "user_abc", iss: env.CLERK_ISSUER, exp: now + 60, nbf: now - 5, iat: now - 5, azp: "http://localhost:5173" });

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  priv = kp.privateKey;
  const jwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  setJwksForTest([{ ...jwk, kid: "k1", alg: "RS256", use: "sig" } as JsonWebKey]);
});

describe("verifyClerkJwt", () => {
  it("accepts a valid token", async () => { expect(await verifyClerkJwt(await sign(good()), env)).toEqual({ sub: "user_abc" }); });
  it("rejects expired", async () => { expect(await verifyClerkJwt(await sign({ ...good(), exp: now - 1 }), env)).toBeNull(); });
  it("rejects wrong issuer", async () => { expect(await verifyClerkJwt(await sign({ ...good(), iss: "https://evil.test" }), env)).toBeNull(); });
  it("rejects unknown kid", async () => { expect(await verifyClerkJwt(await sign(good(), { alg: "RS256", kid: "nope" }), env)).toBeNull(); });
  it("rejects alg none and HS256", async () => {
    const p = b64u(JSON.stringify(good()));
    expect(await verifyClerkJwt(`${b64u(JSON.stringify({ alg: "none", kid: "k1" }))}.${p}.`, env)).toBeNull();
    expect(await verifyClerkJwt(`${b64u(JSON.stringify({ alg: "HS256", kid: "k1" }))}.${p}.${b64u("x")}`, env)).toBeNull();
  });
  it("rejects a tampered payload", async () => {
    const t = (await sign(good())).split(".");
    t[1] = b64u(JSON.stringify({ ...good(), sub: "user_other" }));
    expect(await verifyClerkJwt(t.join("."), env)).toBeNull();
  });
  it("rejects azp not in ALLOWED_ORIGIN", async () => { expect(await verifyClerkJwt(await sign({ ...good(), azp: "https://evil.test" }), env)).toBeNull(); });
});
```

- [ ] **Step 2: Run → FAIL ("Cannot find module '../src/clerk'")**

- [ ] **Step 3: Implement `clerk.ts`**

```ts
// worker/src/clerk.ts
import type { Env } from "./env";

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { keys: JsonWebKey[]; at: number } | null = null;
let jwksOverride: JsonWebKey[] | null = null;
export function setJwksForTest(keys: JsonWebKey[] | null): void { jwksOverride = keys; jwksCache = null; }

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(fromB64u(s))) as Record<string, unknown>;

async function jwks(env: Env, fetchFn: typeof fetch): Promise<JsonWebKey[]> {
  if (jwksOverride) return jwksOverride;
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  try {
    const res = await fetchFn(`${env.CLERK_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { keys: JsonWebKey[] };
    jwksCache = { keys: body.keys, at: Date.now() };
  } catch {
    if (!jwksCache) return []; // no keys yet: every token fails
    // keep serving the stale cache on fetch failure (spec: Error handling)
  }
  return jwksCache!.keys;
}

/** Verifies a Clerk session JWT (RS256 only). Returns the Clerk user id, or null. */
export async function verifyClerkJwt(token: string, env: Env, now = Date.now() / 1000, fetchFn: typeof fetch = fetch): Promise<{ sub: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !env.CLERK_ISSUER) return null;
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = json(parts[0]); payload = json(parts[1]); } catch { return null; }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const jwk = (await jwks(env, fetchFn)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { return null; }
  if (!ok) return null;
  const skew = 5;
  if (payload.iss !== env.CLERK_ISSUER) return null;
  if (typeof payload.exp !== "number" || payload.exp + skew <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf - skew > now) return null;
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("user_")) return null;
  if (typeof payload.azp === "string") {
    const allowed = env.ALLOWED_ORIGIN.split(",").map((o) => o.trim());
    if (!allowed.includes(payload.azp)) return null;
  }
  return { sub: payload.sub };
}

const CLERK_API = "https://api.clerk.com/v1";
export async function clerkUserEmail(id: string, env: Env, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${CLERK_API}/users/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
  if (!res.ok) throw new Error(`clerk_${res.status}`);
  const u = (await res.json()) as { primary_email_address_id?: string; email_addresses?: { id: string; email_address: string }[] };
  return u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address ?? u.email_addresses?.[0]?.email_address ?? "";
}
export async function deleteClerkUser(id: string, env: Env, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`${CLERK_API}/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
  if (!res.ok && res.status !== 404) throw new Error(`clerk_${res.status}`);
}
```

- [ ] **Step 4: Run clerk test → PASS**

- [ ] **Step 5: Extend `session.ts`**

Change the interface and the validation in `verifySession`:

```ts
import type { Plan } from "./plan";
export interface SessionPayload { vid: string; exp: number; plan?: Plan; uid?: string }
export function sessionPlan(s: SessionPayload): Plan { return s.plan ?? "anon"; }
```

In `verifySession`, after the `vid`/`exp` type checks, add:
`if (payload.plan !== undefined && !["anon", "free", "trial", "pro"].includes(payload.plan)) return null;`

- [ ] **Step 6: Write failing `/session` tests (append to `worker/test/session.test.ts`)**

```ts
import { sessionHandler, configureSessionDeps } from "../src/handlers/session";
import { verifySession, sessionPlan } from "../src/session";
// …reuse the RS256 helpers from clerk.test.ts by moving them to worker/test/jwt-helpers.ts (export `makeSigner()` returning { sign, jwk }) and import here and in clerk.test.ts.

describe("POST /session with a Clerk JWT", () => {
  it("creates the user, issues a 600 s token with plan trial", async () => {
    configureSessionDeps({ userEmail: async () => "new@x.y" });
    const res = await sessionHandler(new Request("https://ai.example/session", { method: "POST", headers: { authorization: `Bearer ${await sign({ ...good(), sub: "user_s1" })}` } }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number; plan: string };
    expect(body.plan).toBe("trial");
    const s = (await verifySession(body.token, env.SESSION_SECRET))!;
    expect(s).toMatchObject({ vid: "u:user_s1", uid: "user_s1", plan: "trial" });
    expect(body.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
  });
  it("401 for an invalid Clerk JWT (never falls back to anonymous)", async () => {
    const res = await sessionHandler(new Request("https://ai.example/session", { method: "POST", headers: { authorization: "Bearer a.b.c" } }), env);
    expect(res.status).toBe(401);
  });
  it("legacy anonymous token without plan reads as anon", async () => {
    expect(sessionPlan({ vid: "abc", exp: 1 })).toBe("anon");
  });
  it("503 account_unavailable when Clerk email lookup fails for a new user", async () => {
    configureSessionDeps({ userEmail: async () => { throw new Error("clerk_500"); } });
    const res = await sessionHandler(new Request("https://ai.example/session", { method: "POST", headers: { authorization: `Bearer ${await sign({ ...good(), sub: "user_s2" })}` } }), env);
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 7: Implement in `handlers/session.ts`**

```ts
import { verifyClerkJwt, clerkUserEmail } from "../clerk";
import { ensureUser, getUser } from "../users";
import { planOf } from "../plan";

export interface SessionDeps { userEmail(id: string, env: Env): Promise<string> }
const deps: SessionDeps = { userEmail: (id, env) => clerkUserEmail(id, env) };
export function configureSessionDeps(p: Partial<SessionDeps>): void { Object.assign(deps, p); }
export const USER_SESSION_SECONDS = 600;

export async function sessionHandler(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const claims = await verifyClerkJwt(auth.slice(7), env);
    if (!claims) return json({ error: "unauthorized" }, 401, env);
    const now = Math.floor(Date.now() / 1000);
    let user;
    try {
      user = await getUser(env.DB, claims.sub);
      if (!user) user = await ensureUser(env.DB, claims.sub, await deps.userEmail(claims.sub, env), now);
    } catch { return json({ error: "account_unavailable" }, 503, env); }
    const plan = planOf(user, now);
    const exp = now + USER_SESSION_SECONDS;
    const token = await signSession({ vid: `u:${claims.sub}`, uid: claims.sub, plan, exp }, env.SESSION_SECRET);
    return json({ token, expiresAt: exp, plan }, 200, env);
  }
  // …existing Turnstile path unchanged, adding `plan: "anon"` to the JSON response.
}
```

- [ ] **Step 8: Run the session and clerk tests → PASS; full worker suite + typecheck; commit**

```bash
git add worker/src/clerk.ts worker/src/session.ts worker/src/handlers/session.ts worker/test/clerk.test.ts worker/test/session.test.ts worker/test/jwt-helpers.ts
git commit -m "feat(worker): verify Clerk JWTs and issue plan-aware session tokens"
```

---

### Task 4: Per-plan limits on `/ai`, `/ocr` and `/live`

**Files:**
- Create: `worker/src/limits.ts`
- Modify: `worker/src/handlers/ai.ts`, `worker/src/handlers/ocr.ts`, `worker/src/handlers/live.ts`, `worker/src/voiceQuota.ts`
- Test: `worker/test/limits.test.ts`, extend `worker/test/ai.test.ts`, `ocr.test.ts`, `live.test.ts`

**Interfaces:**
- Consumes: `sessionPlan`, `paywallOn`, `getUser`, `planOf`.
- Produces:
  - `LIMITS: Record<Exclude<Plan,"anon">, { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number; edit: boolean }>`
  - `monthKey(plan: Plan, periodEnd: number | null, now: number): string` (`p<periodEnd>` for pro with a period end, else `YYYY-MM`)
  - `checkUsage(kv, sub, plan, kind: "ai" | "ocr", weight, monthKey, now): Promise<{ ok: true; resetAt: number } | { ok: false; error: "daily_limit" | "monthly_limit" | "pro_required"; resetAt: number; scope: "day" | "month" }>`, which charges on success
  - `voiceAllowance(kv, sub, plan, monthKey, now): Promise<number>`: the seconds limit to pass to `admitVoice` for today, i.e. min(the day cap, the month cap − month used + today used)
  - `addVoiceMonth(kv, sub, monthKey, deltaSec): Promise<void>`

| plan | aiDay | aiMonth | voiceDaySec | voiceMonthSec | ocrMonth | edit |
|---|---|---|---|---|---|---|
| free | 5 | 5 × 31 | 300 | 300 × 31 | 0 | false |
| trial | 100 | 1000 | 1800 | 7200 | 300 | true |
| pro | 100 | 1000 | 1800 | 7200 | 300 | true |

- [ ] **Step 1: Write the failing limits tests**

```ts
// worker/test/limits.test.ts
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
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `limits.ts`**

```ts
// worker/src/limits.ts
import type { Plan } from "./plan";
import { utcDay } from "./session";
import { nextUtcMidnight } from "./quota";
import { readVoice } from "./voiceQuota";

type Paid = Exclude<Plan, "anon">;
export const LIMITS: Record<Paid, { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number; edit: boolean }> = {
  free: { aiDay: 5, aiMonth: 5 * 31, voiceDaySec: 300, voiceMonthSec: 300 * 31, ocrMonth: 0, edit: false },
  trial: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
  pro: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
};

export function monthKey(plan: Plan, periodEnd: number | null, now: number): string {
  return plan === "pro" && periodEnd ? `p${periodEnd}` : new Date(now * 1000).toISOString().slice(0, 7);
}
function monthReset(mk: string, now: number): number {
  if (mk.startsWith("p")) return Number(mk.slice(1));
  const d = new Date(now * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}
const num = async (kv: KVNamespace, k: string) => Number((await kv.get(k)) ?? "0");
const TTL = 40 * 86400;

export type UsageCheck = { ok: true; resetAt: number } | { ok: false; error: "daily_limit" | "monthly_limit" | "pro_required"; resetAt: number; scope: "day" | "month" };

export async function checkUsage(kv: KVNamespace, sub: string, plan: Paid, kind: "ai" | "ocr", weight: number, mk: string, now: number): Promise<UsageCheck> {
  const L = LIMITS[plan];
  const dayCap = kind === "ai" ? L.aiDay : Infinity;
  const monthCap = kind === "ai" ? L.aiMonth : L.ocrMonth;
  if (monthCap === 0) return { ok: false, error: "pro_required", resetAt: 0, scope: "month" };
  const dKey = `d:${kind}:${sub}:${utcDay(now)}`, mKey = `m:${kind}:${sub}:${mk}`;
  const [d, m] = await Promise.all([num(kv, dKey), num(kv, mKey)]);
  if (m + weight > monthCap) return { ok: false, error: "monthly_limit", resetAt: monthReset(mk, now), scope: "month" };
  if (d + weight > dayCap) return { ok: false, error: "daily_limit", resetAt: nextUtcMidnight(now), scope: "day" };
  try { await Promise.all([kv.put(dKey, String(d + weight), { expirationTtl: 2 * 86400 }), kv.put(mKey, String(m + weight), { expirationTtl: TTL })]); } catch { /* fail open on accounting, like quota.ts */ }
  return { ok: true, resetAt: nextUtcMidnight(now) };
}

export async function voiceAllowance(kv: KVNamespace, sub: string, plan: Paid, mk: string, now: number): Promise<number> {
  const L = LIMITS[plan];
  const monthUsed = await num(kv, `m:voice:${sub}:${mk}`);
  const todayUsed = (await readVoice(kv, sub, utcDay(now))).seconds;
  return Math.max(0, Math.min(L.voiceDaySec, L.voiceMonthSec - monthUsed + todayUsed));
}
export async function addVoiceMonth(kv: KVNamespace, sub: string, mk: string, deltaSec: number): Promise<void> {
  const k = `m:voice:${sub}:${mk}`;
  await kv.put(k, String(Math.max(0, (await num(kv, k)) + deltaSec)), { expirationTtl: TTL });
}
```

- [ ] **Step 4: Run limits test → PASS**

- [ ] **Step 5: Write failing handler tests**

Append to `worker/test/ai.test.ts`. Use the existing helpers there for calling `aiHandler`, and the `signSession` import:

```ts
describe("/ai with PAYWALL_ENABLED", () => {
  const on = { ...env, PAYWALL_ENABLED: "true" } as typeof env;
  it("anon → 403 account_required", async () => {
    const tok = await signSession({ vid: "anon1", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    const res = await callAi(on, tok, validSummarizeBody());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "account_required" });
  });
  it("free user over 5/day → 429 daily_limit scope day", async () => {
    const tok = await signSession({ vid: "u:user_f1", uid: "user_f1", plan: "free", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    for (let i = 0; i < 5; i++) expect((await callAi(on, tok, validSummarizeBody(), okStream)).status).toBe(200);
    const res = await callAi(on, tok, validSummarizeBody(), okStream);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "daily_limit", scope: "day" });
  });
  it("flag off: signed-in user uses the old anonymous quota (unchanged behaviour)", async () => {
    const tok = await signSession({ vid: "u:user_f2", uid: "user_f2", plan: "free", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    expect((await callAi(env, tok, validSummarizeBody(), okStream)).status).toBe(200);
  });
});
```

If `ai.test.ts` doesn't already have `callAi`, `validSummarizeBody` and `okStream` helpers, add them at the top of the file. They should wrap the existing pattern in that file: build a `Request` to `/ai` with a Bearer token, call `aiHandler(req, env, ctx, stream)`, and use a `stream` stub that yields one text delta and usage.

Add the same three cases to `ocr.test.ts`, with these changes:
- free → 403 `pro_required`;
- pro with weight 301 → 429 `monthly_limit`.

Add to `live.test.ts`:
- anon with flag on → 403 `account_required`;
- a free user with 300 s used today → 429 `voice_limit` with `sessionSeconds: 600`, because their 300 s day cap is below a session.

- [ ] **Step 6: Implement the gate in each handler**

Add a shared helper in `limits.ts`:

```ts
import type { Env } from "./env";
import { paywallOn, planOf } from "./plan";
import { sessionPlan, type SessionPayload } from "./session";
import { getUser } from "./users";

/** Resolves the caller's plan and month key when the paywall is on; null means "use legacy anonymous quotas". */
export async function gateFor(env: Env, s: SessionPayload, now: number): Promise<{ plan: Exclude<Plan, "anon">; mk: string } | "account_required" | "account_unavailable" | null> {
  if (!paywallOn(env)) return null;
  const plan = sessionPlan(s);
  if (plan === "anon" || !s.uid) return "account_required";
  let periodEnd: number | null = null;
  if (plan === "pro") {
    try { periodEnd = (await getUser(env.DB, s.uid))?.current_period_end ?? null; } catch { return "account_unavailable"; }
  }
  return { plan, mk: monthKey(plan, periodEnd, now) };
}
```

In `handlers/ai.ts` (also import `utcDay` from `../session` and `gateFor`, `checkUsage` from `../limits`), replace the `checkQuota` call with:

```ts
  const now = Date.now() / 1000;
  const gate = await gateFor(env, session, now);
  if (gate === "account_required") return json({ error: "account_required" }, 403, env);
  if (gate === "account_unavailable") return json({ error: "account_unavailable" }, 503, env);
  let quota;
  if (gate) {
    const u = await checkUsage(env.QUOTA, session.vid, gate.plan, "ai", 1, gate.mk, now);
    if (!u.ok) return json({ error: u.error, resetAt: u.resetAt, scope: u.scope }, u.error === "pro_required" ? 403 : 429, env);
    quota = { ok: true as const, day: utcDay(now), resetAt: u.resetAt, charged: { requests: 0, tokens: 0 }, remaining: { requests: 0, tokens: 0 } };
  } else {
    quota = await checkQuota(env.QUOTA, session.vid, now, estimate);
    if (!quota.ok) return json({ error: quota.reason, resetAt: quota.resetAt }, 429, env);
  }
```

When `gate` is set, skip `recordTokens`: per-plan limits count requests, not tokens.

Do the same in `handlers/ocr.ts`, with kind `"ocr"` and weight `pages.length`.

In `handlers/live.ts`, before `admitVoice`:

```ts
  const now = Date.now() / 1000;
  const gate = await gateFor(env, session, now);
  if (gate === "account_required") return json({ error: "account_required" }, 403, env);
  if (gate === "account_unavailable") return json({ error: "account_unavailable" }, 503, env);
  const limit = gate ? await voiceAllowance(env.QUOTA, session.vid, gate.plan, gate.mk, now) : dailyVoiceSeconds(env);
```

After `chargeVoice` succeeds, when `gate` is set: `await addVoiceMonth(env.QUOTA, session.vid, gate.mk, ADMISSION_SECONDS)`.

In `liveUsageHandler`, after `reconcileVoice` returns the delta (actual − charged), when `gate` is set: `await addVoiceMonth(env.QUOTA, session.vid, gate.mk, delta)`. Change `reconcileVoice` to also return `delta` in its result, and update its tests.

- [ ] **Step 7: Run the worker suite + typecheck → PASS; commit**

```bash
git add worker/src/limits.ts worker/src/handlers/ai.ts worker/src/handlers/ocr.ts worker/src/handlers/live.ts worker/src/voiceQuota.ts worker/test
git commit -m "feat(worker): per-plan day and month limits behind PAYWALL_ENABLED"
```

---

### Task 5: `/me`, `/terms/accept` and `/account/delete`

**Files:**
- Create: `worker/src/terms.ts`, `worker/src/handlers/me.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/me.test.ts`

**Interfaces:**
- Consumes: `verifySession`, `getUser`, `updateUser`, `deleteUser`, `planOf`, `LIMITS`, `monthKey`, `deleteClerkUser`, and `cancelSubscription` (Task 6: `/account/delete` imports it, so build Task 6's `stripe.ts` cancel helper first or stub it in the test via deps).
- Produces:
  - `TERMS_VERSION = "2026-10-12"`.
  - `POST /me` → `{ plan, trialEndsAt, periodEnd, status, termsAccepted: boolean, termsVersion, paywall: boolean, usage: { aiDay, aiMonth, voiceDaySec, voiceMonthSec, ocrMonth }, limits: (LIMITS[plan] | null) }`. For anon it returns `{ plan: "anon", paywall }` only.
  - `POST /terms/accept` with `{ version }` → 200 `{ ok: true }`; 400 if the version isn't current.
  - `POST /account/delete` → 200 `{ ok: true }`.

- [ ] **Step 1: Write failing tests**

```ts
// worker/test/me.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { meHandler, termsHandler, deleteAccountHandler, configureMeDeps } from "../src/handlers/me";
import { signSession } from "../src/session";
import { ensureUser, getUser } from "../src/users";
import { TERMS_VERSION } from "../src/terms";

const tok = (uid: string, plan: "trial" | "pro" | "free" = "trial") => signSession({ vid: `u:${uid}`, uid, plan, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
const post = async (h: typeof meHandler, t: string | null, body?: unknown) => h(new Request("https://ai.example/x", { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

describe("/me", () => {
  it("anon token → plan anon only", async () => {
    const t = await signSession({ vid: "x", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    expect(await (await post(meHandler, t)).json()).toEqual({ plan: "anon", paywall: false });
  });
  it("user → plan, trial end, terms state, zero usage", async () => {
    await ensureUser(env.DB, "user_me1", "m@x.y", Math.floor(Date.now() / 1000));
    const body = (await (await post(meHandler, await tok("user_me1"))).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ plan: "trial", termsAccepted: false, termsVersion: TERMS_VERSION, usage: { aiDay: 0, aiMonth: 0, voiceDaySec: 0, voiceMonthSec: 0, ocrMonth: 0 } });
  });
  it("401 without a token", async () => { expect((await post(meHandler, null)).status).toBe(401); });
});
describe("/terms/accept", () => {
  it("stores the current version, rejects others", async () => {
    await ensureUser(env.DB, "user_t1", "t@x.y", 1);
    expect((await post(termsHandler, await tok("user_t1"), { version: "old" })).status).toBe(400);
    expect((await post(termsHandler, await tok("user_t1"), { version: TERMS_VERSION })).status).toBe(200);
    expect((await getUser(env.DB, "user_t1"))?.terms_version).toBe(TERMS_VERSION);
  });
});
describe("/account/delete", () => {
  it("cancels Stripe, deletes Clerk user and the row", async () => {
    const calls: string[] = [];
    configureMeDeps({ cancelSubscription: async (c) => { calls.push(`cancel:${c}`); }, deleteClerkUser: async (id) => { calls.push(`clerk:${id}`); } });
    await ensureUser(env.DB, "user_d1", "d@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id = 'cus_d1' WHERE id = 'user_d1'").run();
    expect((await post(deleteAccountHandler, await tok("user_d1"))).status).toBe(200);
    expect(calls).toEqual(["cancel:cus_d1", "clerk:user_d1"]);
    expect(await getUser(env.DB, "user_d1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `terms.ts` and `handlers/me.ts`**

```ts
// worker/src/terms.ts
export const TERMS_VERSION = "2026-10-12";
```

```ts
// worker/src/handlers/me.ts
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

export async function deleteAccountHandler(request: Request, env: Env): Promise<Response> {
  const s = await authed(request, env);
  if (!s?.uid) return json({ error: "unauthorized" }, 401, env);
  try {
    const user = await getUser(env.DB, s.uid);
    if (user?.stripe_customer_id) await deps.cancelSubscription(user.stripe_customer_id, env);
    await deps.deleteClerkUser(s.uid, env);
    await deleteUser(env.DB, s.uid);
  } catch { return json({ error: "account_unavailable" }, 503, env); }
  return json({ ok: true }, 200, env);
}
```

Routes in `index.ts`: `"/me": (r, env) => meHandler(r, env), "/terms/accept": (r, env) => termsHandler(r, env), "/account/delete": (r, env) => deleteAccountHandler(r, env)`.

- [ ] **Step 4: Run → PASS (after Task 6's `stripe.ts` exists; if executing strictly in order, create `worker/src/stripe.ts` now with just `cancelCustomerSubscriptions` from Task 6 Step 3). Full suite + typecheck; commit.**

```bash
git add worker/src/terms.ts worker/src/handlers/me.ts worker/src/index.ts worker/src/stripe.ts worker/test/me.test.ts
git commit -m "feat(worker): /me, terms acceptance and account deletion"
```

---

### Task 6: Stripe checkout and portal

**Files:**
- Create: `worker/src/stripe.ts`, `worker/src/handlers/billing.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/billing.test.ts`

**Interfaces:**
- Produces:
  - `stripeFetch(path: string, env: Env, form?: Record<string, string>, method?: "GET" | "POST" | "DELETE", fetchFn?): Promise<any>`, which throws `Error("stripe_<status>")` on a non-2xx response
  - `cancelCustomerSubscriptions(customerId, env, fetchFn?)`
  - `POST /billing/checkout` with `{ interval: "month" | "year" }` → `{ url }`
  - `POST /billing/portal` → `{ url }`
  - `configureBillingDeps({ fetch })` for tests

- [ ] **Step 1: Write failing tests with a fake Stripe**

```ts
// worker/test/billing.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { checkoutHandler, portalHandler, configureBillingDeps } from "../src/handlers/billing";
import { signSession } from "../src/session";
import { ensureUser, getUser } from "../src/users";

const calls: { url: string; body: string }[] = [];
const fakeStripe: typeof fetch = async (input, init) => {
  const url = String(input), body = String(init?.body ?? "");
  calls.push({ url, body });
  if (url.endsWith("/v1/customers")) return Response.json({ id: "cus_new" });
  if (url.endsWith("/v1/checkout/sessions")) return Response.json({ url: "https://checkout.stripe.test/s" });
  if (url.endsWith("/v1/billing_portal/sessions")) return Response.json({ url: "https://billing.stripe.test/p" });
  return new Response("{}", { status: 404 });
};
const tok = (uid: string) => signSession({ vid: `u:${uid}`, uid, plan: "trial", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
const post = async (h: typeof checkoutHandler, t: string, body?: unknown) => h(new Request("https://ai.example/b", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }), env);

beforeEach(() => { calls.length = 0; configureBillingDeps({ fetch: fakeStripe }); });

describe("/billing/checkout", () => {
  it("creates a customer once, then a subscription checkout with the server-side price", async () => {
    await ensureUser(env.DB, "user_b1", "b@x.y", 1);
    const res = await post(checkoutHandler, await tok("user_b1"), { interval: "year" });
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect((await getUser(env.DB, "user_b1"))?.stripe_customer_id).toBe("cus_new");
    const co = calls.find((c) => c.url.endsWith("/checkout/sessions"))!;
    const form = new URLSearchParams(co.body);
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("line_items[0][price]")).toBe("price_year");
    expect(form.get("client_reference_id")).toBe("user_b1");
    expect(form.get("customer")).toBe("cus_new");
    expect(form.get("success_url")).toBe("http://localhost:5173/?checkout=success");
    await post(checkoutHandler, await tok("user_b1"), { interval: "month" });
    expect(calls.filter((c) => c.url.endsWith("/v1/customers")).length).toBe(1);
  });
  it("400 for an unknown interval; 401 for anon", async () => {
    await ensureUser(env.DB, "user_b2", "b@x.y", 1);
    expect((await post(checkoutHandler, await tok("user_b2"), { interval: "week" })).status).toBe(400);
    const anon = await signSession({ vid: "a", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    expect((await post(checkoutHandler, anon, { interval: "month" })).status).toBe(401);
  });
});
describe("/billing/portal", () => {
  it("returns a portal url for a customer; 409 without one", async () => {
    await ensureUser(env.DB, "user_b3", "b@x.y", 1);
    expect((await post(portalHandler, await tok("user_b3"))).status).toBe(409);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_3' WHERE id='user_b3'").run();
    expect(await (await post(portalHandler, await tok("user_b3"))).json()).toEqual({ url: "https://billing.stripe.test/p" });
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `stripe.ts`**

```ts
// worker/src/stripe.ts
import type { Env } from "./env";

const API = "https://api.stripe.com/v1";
let stripeFetchImpl: typeof fetch = (i, init) => fetch(i, init);
export function setStripeFetch(f: typeof fetch): void { stripeFetchImpl = f; }

/** Minimal Stripe REST client: form-encoded bodies, bearer secret key. */
export async function stripeFetch<T = Record<string, unknown>>(path: string, env: Env, form?: Record<string, string>, method: "GET" | "POST" | "DELETE" = form ? "POST" : "GET"): Promise<T> {
  const res = await stripeFetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!res.ok) throw new Error(`stripe_${res.status}`);
  return (await res.json()) as T;
}

export async function cancelCustomerSubscriptions(customerId: string, env: Env): Promise<void> {
  const subs = await stripeFetch<{ data: { id: string; status: string }[] }>(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`, env);
  for (const s of subs.data) if (s.status !== "canceled" && s.status !== "incomplete_expired") await stripeFetch(`/subscriptions/${s.id}`, env, undefined, "DELETE");
}
```

- [ ] **Step 4: Implement `handlers/billing.ts` (checkout + portal)**

```ts
// worker/src/handlers/billing.ts
import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { getUser, updateUser } from "../users";
import { stripeFetch, setStripeFetch } from "../stripe";

export function configureBillingDeps(p: { fetch?: typeof fetch }): void { if (p.fetch) setStripeFetch(p.fetch); }

async function user(request: Request, env: Env) {
  const a = request.headers.get("authorization") ?? "";
  const s = a.startsWith("Bearer ") ? await verifySession(a.slice(7), env.SESSION_SECRET) : null;
  if (!s?.uid) return null;
  return getUser(env.DB, s.uid);
}

export async function checkoutHandler(request: Request, env: Env): Promise<Response> {
  let u;
  try { u = await user(request, env); } catch { return json({ error: "account_unavailable" }, 503, env); }
  if (!u) return json({ error: "unauthorized" }, 401, env);
  let interval: unknown;
  try { interval = ((await request.json()) as { interval?: unknown }).interval; } catch { /* invalid */ }
  const price = interval === "month" ? env.STRIPE_PRICE_MONTHLY : interval === "year" ? env.STRIPE_PRICE_YEARLY : null;
  if (!price) return json({ error: "invalid_interval" }, 400, env);
  try {
    let customer = u.stripe_customer_id;
    if (!customer) {
      customer = (await stripeFetch<{ id: string }>("/customers", env, { email: u.email, "metadata[clerk_user_id]": u.id })).id;
      await updateUser(env.DB, u.id, { stripe_customer_id: customer });
    }
    const app = env.APP_URL.replace(/\/$/, "");
    const session = await stripeFetch<{ url: string }>("/checkout/sessions", env, {
      mode: "subscription", customer, client_reference_id: u.id,
      "line_items[0][price]": price, "line_items[0][quantity]": "1",
      success_url: `${app}/?checkout=success`, cancel_url: `${app}/?checkout=cancel`,
      allow_promotion_codes: "true",
    });
    return json({ url: session.url }, 200, env);
  } catch { return json({ error: "billing_unavailable" }, 502, env); }
}

export async function portalHandler(request: Request, env: Env): Promise<Response> {
  let u;
  try { u = await user(request, env); } catch { return json({ error: "account_unavailable" }, 503, env); }
  if (!u) return json({ error: "unauthorized" }, 401, env);
  if (!u.stripe_customer_id) return json({ error: "no_customer" }, 409, env);
  try {
    const p = await stripeFetch<{ url: string }>("/billing_portal/sessions", env, { customer: u.stripe_customer_id, return_url: env.APP_URL });
    return json({ url: p.url }, 200, env);
  } catch { return json({ error: "billing_unavailable" }, 502, env); }
}
```

Routes in `index.ts`: `/billing/checkout`, `/billing/portal`.

- [ ] **Step 5: Run → PASS; full suite + typecheck; commit**

```bash
git add worker/src/stripe.ts worker/src/handlers/billing.ts worker/src/index.ts worker/test/billing.test.ts
git commit -m "feat(worker): Stripe checkout and customer portal"
```

---

### Task 7: Stripe webhook

**Files:**
- Modify: `worker/src/stripe.ts`, `worker/src/handlers/billing.ts`, `worker/src/index.ts`
- Test: `worker/test/webhook.test.ts`

**Interfaces:**
- Produces:
  - `verifyStripeSignature(rawBody: string, header: string | null, secret: string, now?: number, toleranceSec = 300): Promise<boolean>`
  - `POST /billing/webhook` → 200 `{ received: true }` on success or duplicate; 400 on a bad signature.
- Handled events:
  - `checkout.session.completed`: links `customer` to `client_reference_id` user, then fetches the subscription and applies it.
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`: apply the subscription.
  - `invoice.payment_failed`: sets `past_due_since` if null.
  - `invoice.paid`: clears `past_due_since`.
- **Apply rule:** take `status` and `current_period_end` from the subscription object. When the event is `.deleted`, use status `canceled`. To stay correct under out-of-order delivery, always re-fetch `GET /subscriptions/{id}` and store the fetched state, not the event payload.

- [ ] **Step 1: Write failing tests**

```ts
// worker/test/webhook.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { webhookHandler, configureBillingDeps } from "../src/handlers/billing";
import { verifyStripeSignature } from "../src/stripe";
import { ensureUser, getUser } from "../src/users";

async function sign(body: string, secret = env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
let sub = { id: "sub_1", status: "active", current_period_end: 2_000_000_000, customer: "cus_w1" };
const fake: typeof fetch = async (input) => String(input).includes("/subscriptions/") ? Response.json(sub) : new Response("{}", { status: 404 });
const send = async (event: unknown, sig?: string) => {
  const body = JSON.stringify(event);
  return webhookHandler(new Request("https://ai.example/billing/webhook", { method: "POST", headers: { "stripe-signature": sig ?? (await sign(body)) }, body }), env);
};
beforeEach(() => { configureBillingDeps({ fetch: fake }); sub = { id: "sub_1", status: "active", current_period_end: 2_000_000_000, customer: "cus_w1" }; });

describe("verifyStripeSignature", () => {
  it("valid / tampered / stale", async () => {
    const body = '{"a":1}';
    expect(await verifyStripeSignature(body, await sign(body), env.STRIPE_WEBHOOK_SECRET)).toBe(true);
    expect(await verifyStripeSignature('{"a":2}', await sign(body), env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, await sign(body, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 1000), env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, null, env.STRIPE_WEBHOOK_SECRET)).toBe(false);
  });
});

describe("/billing/webhook", () => {
  it("400 on bad signature", async () => { expect((await send({ id: "evt_x", type: "x" }, "t=1,v1=00")).status).toBe(400); });
  it("checkout.session.completed links the customer via client_reference_id and applies the subscription", async () => {
    await ensureUser(env.DB, "user_w1", "w@x.y", 1);
    const r = await send({ id: "evt_1", type: "checkout.session.completed", data: { object: { client_reference_id: "user_w1", customer: "cus_w1", subscription: "sub_1" } } });
    expect(r.status).toBe(200);
    expect(await getUser(env.DB, "user_w1")).toMatchObject({ stripe_customer_id: "cus_w1", subscription_status: "active", current_period_end: 2_000_000_000 });
  });
  it("duplicate event id is applied once", async () => {
    await ensureUser(env.DB, "user_w2", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w2' WHERE id='user_w2'").run();
    sub = { ...sub, customer: "cus_w2", status: "past_due" };
    const ev = { id: "evt_dup", type: "invoice.payment_failed", data: { object: { customer: "cus_w2" } } };
    await send(ev);
    const first = (await getUser(env.DB, "user_w2"))!.past_due_since;
    await new Promise((r) => setTimeout(r, 1100));
    expect((await send(ev)).status).toBe(200);
    expect((await getUser(env.DB, "user_w2"))!.past_due_since).toBe(first);
  });
  it("out-of-order: an older 'updated' payload never overwrites the fetched current state", async () => {
    await ensureUser(env.DB, "user_w3", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w3' WHERE id='user_w3'").run();
    sub = { ...sub, customer: "cus_w3", status: "canceled", current_period_end: 1_900_000_000 };
    await send({ id: "evt_old", type: "customer.subscription.updated", data: { object: { ...sub, status: "active" } } });
    expect((await getUser(env.DB, "user_w3"))!.subscription_status).toBe("canceled");
  });
  it("unknown customer without client_reference_id is acknowledged (200) and ignored", async () => {
    sub = { ...sub, customer: "cus_nobody" };
    expect((await send({ id: "evt_n", type: "customer.subscription.updated", data: { object: sub } })).status).toBe(200);
  });
  it("invoice.paid clears past_due_since", async () => {
    await ensureUser(env.DB, "user_w4", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w4', past_due_since=123 WHERE id='user_w4'").run();
    await send({ id: "evt_paid", type: "invoice.paid", data: { object: { customer: "cus_w4" } } });
    expect((await getUser(env.DB, "user_w4"))!.past_due_since).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement the signature check in `stripe.ts`**

```ts
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000), toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(parts.t), v1 = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || v1.length === 0 || Math.abs(now - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time compare against any v1
  return v1.some((sig) => sig.length === mac.length && [...sig].reduce((d, c, i) => d | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}
```

- [ ] **Step 4: Implement `webhookHandler` in `handlers/billing.ts`**

```ts
import { getUserByCustomer } from "../users";
import { verifyStripeSignature } from "../stripe";

type Sub = { id: string; status: string; current_period_end: number; customer: string };

async function applySubscription(env: Env, subId: string, forceStatus?: string): Promise<void> {
  const s = await stripeFetch<Sub>(`/subscriptions/${encodeURIComponent(subId)}`, env);
  const u = await getUserByCustomer(env.DB, s.customer);
  if (!u) return;
  const status = forceStatus ?? s.status;
  const patch: Parameters<typeof updateUser>[2] = { subscription_status: status, current_period_end: s.current_period_end };
  if (status === "active" || status === "trialing") patch.past_due_since = null;
  if ((status === "past_due" || status === "unpaid") && u.past_due_since === null) patch.past_due_since = Math.floor(Date.now() / 1000);
  await updateUser(env.DB, u.id, patch);
}

export async function webhookHandler(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    const seen = await env.DB.prepare("INSERT INTO stripe_events (id, received_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(ev.id, Math.floor(Date.now() / 1000)).run();
    if (seen.meta.changes === 0) return Response.json({ received: true });
    const o = ev.data.object;
    switch (ev.type) {
      case "checkout.session.completed": {
        const uid = o.client_reference_id as string | null, customer = o.customer as string | null;
        if (uid && customer) await updateUser(env.DB, uid, { stripe_customer_id: customer });
        if (typeof o.subscription === "string") await applySubscription(env, o.subscription);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await applySubscription(env, o.id as string);
        break;
      case "customer.subscription.deleted":
        await applySubscription(env, o.id as string, "canceled");
        break;
      case "invoice.payment_failed": {
        const u = await getUserByCustomer(env.DB, o.customer as string);
        if (u && u.past_due_since === null) await updateUser(env.DB, u.id, { past_due_since: Math.floor(Date.now() / 1000) });
        break;
      }
      case "invoice.paid": {
        const u = await getUserByCustomer(env.DB, o.customer as string);
        if (u) await updateUser(env.DB, u.id, { past_due_since: null });
        break;
      }
    }
  } catch {
    // let Stripe retry: remove the idempotency marker so the retry is processed
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(ev.id).run().catch(() => {});
    return new Response("retry", { status: 500 });
  }
  return Response.json({ received: true });
}
```

In `index.ts`, route `/billing/webhook` to `webhookHandler`. It must not be wrapped by the origin and CORS logic: the dispatcher already passes the raw `Request`, and the handler returns its own `Response`, so no change is needed beyond the route.

- [ ] **Step 5: Run → PASS; full suite + typecheck; commit**

```bash
git add worker/src/stripe.ts worker/src/handlers/billing.ts worker/src/index.ts worker/test/webhook.test.ts
git commit -m "feat(worker): Stripe webhook with signature check, idempotency and refetch-on-apply"
```

---

### Task 8: App configuration, Clerk and the AI client session

**Files:**
- Modify: `package.json` (`npm i @clerk/clerk-react`), `.env.production`, `.env.example`, `vite.config.ts`, `src/main.tsx`, `src/ai/client.ts`, `src/components/ai/useAiClient.ts`
- Create: `src/account/terms.ts`, `src/account/capabilities.ts`
- Test: `src/ai/client.test.ts` (extend), `src/account/capabilities.test.ts`, `vite.config` guard test via build

**Interfaces:**
- Produces:
  - `paywallEnabled(): boolean` (reads `import.meta.env.VITE_PAYWALL_ENABLED === "true"`)
  - `type Plan = "anon" | "free" | "trial" | "pro"`
  - `can(plan: Plan, feature: "edit" | "ai" | "voice" | "deepOcr", paywall = paywallEnabled()): boolean`: with paywall off, everything is `true`; with it on, `edit` and `deepOcr` need trial or pro, and `ai` and `voice` need anything except anon
  - `AiClient` options gain `getAuthToken?: () => Promise<string | null>`. The session prefers the Clerk token when present, else Turnstile.
  - New methods:
    - `me(): Promise<MeResponse>`
    - `acceptTerms(version: string): Promise<void>`
    - `checkout(interval: "month" | "year"): Promise<string>`, which returns a URL
    - `portal(): Promise<string>`
    - `deleteAccount(): Promise<void>`
    - `resetSession(): void`, called on sign-in and sign-out
  - `interface MeResponse { plan: Plan; paywall: boolean; trialEndsAt?: number; periodEnd?: number | null; status?: string | null; termsAccepted?: boolean; termsVersion?: string; usage?: { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number }; limits?: { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number; edit: boolean } | null }`
  - `src/account/terms.ts` exports:
    - `TERMS_VERSION = "2026-10-12"`
    - `TERMS_CHECKBOX = "I understand PDF Studio is a general documentation tool, I won't upload identifiable patient information, and I use it at my own risk."`
    - `TERMS_URL = "/terms.html"`

- [ ] **Step 1: Write failing `can()` table and client tests**

```ts
// src/account/capabilities.test.ts
import { describe, it, expect } from "vitest";
import { can } from "./capabilities";
describe("can", () => {
  it.each([
    ["anon", "edit", false], ["anon", "ai", false], ["free", "ai", true], ["free", "edit", false], ["free", "deepOcr", false],
    ["trial", "edit", true], ["pro", "deepOcr", true], ["free", "voice", true],
  ] as const)("%s %s → %s (paywall on)", (plan, f, ok) => { expect(can(plan, f, true)).toBe(ok); });
  it("paywall off: everything allowed", () => { expect(can("anon", "edit", false)).toBe(true); });
});
```

Append to `src/ai/client.test.ts`:

```ts
it("uses the Clerk token for /session when signed in, Turnstile otherwise", async () => {
  const fetchFn = vi.fn().mockResolvedValue(json({ token: "s1", expiresAt: 9, plan: "trial" }));
  const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "ts", getAuthToken: async () => "clerk.jwt.x", fetchFn });
  await c.ensureSession();
  expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer clerk.jwt.x" });
  const c2 = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "ts", getAuthToken: async () => null, fetchFn });
  await c2.ensureSession();
  expect(JSON.parse(String((fetchFn.mock.calls[1][1] as RequestInit).body))).toEqual({ turnstileToken: "ts" });
});
it("checkout posts the interval and returns the url", async () => {
  const fetchFn = vi.fn().mockResolvedValueOnce(json({ token: "s1" })).mockResolvedValueOnce(json({ url: "https://co" }));
  const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "ts", getAuthToken: async () => "j", fetchFn });
  expect(await c.checkout("year")).toBe("https://co");
  expect(JSON.parse(String((fetchFn.mock.calls[1][1] as RequestInit).body))).toEqual({ interval: "year" });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```ts
// src/account/capabilities.ts
export type Plan = "anon" | "free" | "trial" | "pro";
export type Feature = "edit" | "ai" | "voice" | "deepOcr";
export const paywallEnabled = (): boolean => import.meta.env.VITE_PAYWALL_ENABLED === "true";
export function can(plan: Plan, feature: Feature, paywall: boolean = paywallEnabled()): boolean {
  if (!paywall) return true;
  if (feature === "edit" || feature === "deepOcr") return plan === "trial" || plan === "pro";
  return plan !== "anon";
}
```

`src/ai/client.ts`:
- add `private getAuthToken?: () => Promise<string | null>;` and set it from the options in the constructor;
- change `fetchSession`:

```ts
  private async fetchSession(): Promise<string> {
    const jwt = this.getAuthToken ? await this.getAuthToken().catch(() => null) : null;
    const res = jwt
      ? await this.fetchFn(`${this.baseUrl}/session`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } })
      : await this.fetchFn(`${this.baseUrl}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken: await this.getTurnstileToken() }) });
    if (!res.ok) throw new Error(res.status === 503 ? "account_unavailable" : "verification_failed");
    const body = (await res.json()) as { token: string };
    this.token = body.token;
    return this.token;
  }
  resetSession(): void { this.token = null; }
  private async post<T>(path: string, body?: unknown): Promise<T> {
    let token = await this.ensureSession();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (res.status === 401 && attempt === 0) { token = await this.ensureSession(true); continue; }
      if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "upstream"); }
      return (await res.json()) as T;
    }
    throw new Error("upstream");
  }
  me() { return this.post<MeResponse>("/me"); }
  async acceptTerms(version: string) { await this.post("/terms/accept", { version }); }
  async checkout(interval: "month" | "year") { return (await this.post<{ url: string }>("/billing/checkout", { interval })).url; }
  async portal() { return (await this.post<{ url: string }>("/billing/portal")).url; }
  async deleteAccount() { await this.post("/account/delete"); }
```

Export `MeResponse` from `client.ts`, matching the interface above.

`.env.production`: add `VITE_CLERK_PUBLISHABLE_KEY=` (set in Task 13) and `VITE_PAYWALL_ENABLED=false`.

`vite.config.ts`: add `'VITE_CLERK_PUBLISHABLE_KEY'` to `REQUIRED_PROD_ENV`. Extend the check to reject `pk_test_` keys in production builds, i.e. `/^pk_test_/`.

`src/main.tsx`: wrap `<App />` in `<ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">`. In dev, when the key is empty, render `<App />` without Clerk: guard with `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ? … : …`.

`useAiClient.ts`: pass `getAuthToken` from Clerk's `useAuth().getToken`. Clerk's hooks require being inside the provider, so read it through a tiny bridge component `src/account/ClerkBridge.tsx`. That component calls `useAuth()` and stores `getToken` in a module-level `setAuthTokenGetter(fn)`. On every `isSignedIn` change it calls `useAiStore.getState().client?.resetSession()`. `useAiClient` passes `getAuthToken: () => authTokenGetter?.() ?? Promise.resolve(null)`.

- [ ] **Step 4: Run app tests, `tsc --noEmit`, lint, build (with a dummy `pk_live_` value exported in the shell for the guard check, then revert) → PASS; commit**

```bash
git add package.json package-lock.json .env.production .env.example vite.config.ts src/main.tsx src/ai src/account src/components/ai/useAiClient.ts
git commit -m "feat: Clerk provider, plan-aware AI session, account API client"
```

---

### Task 9: `useAccount` store with offline cache

**Files:**
- Create: `src/account/store.ts`
- Test: `src/account/store.test.ts`

**Interfaces:**
- Consumes: `AiClient.me()`, `MeResponse`, `Plan`.
- Produces:
  - `useAccount` zustand store, with state `{ me: MeResponse | null; loading: boolean; error: string | null }`, actions `refresh(): Promise<void>`, `clear(): void` and `setFromCache(): void`, and the selector `plan(): Plan`.
  - The cache is written to `localStorage["pdfstudio.account"] = JSON.stringify({ at: Date.now(), me })` after each successful refresh.
  - `setFromCache` loads it only if it is younger than 7 days and `me` is still null.
  - A fresh `refresh` always replaces the cached value.

- [ ] **Step 1: Failing tests**

```ts
// src/account/store.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAccount, CACHE_KEY, CACHE_MAX_AGE_MS } from "./store";
import { useAiStore } from "../store/ai";

const me = (plan: "pro" | "free") => ({ plan, paywall: true });
beforeEach(() => { localStorage.clear(); useAccount.setState({ me: null, loading: false, error: null }); });

describe("useAccount", () => {
  it("refresh stores me and caches it", async () => {
    useAiStore.setState({ client: { me: vi.fn().mockResolvedValue(me("pro")) } as never });
    await useAccount.getState().refresh();
    expect(useAccount.getState().plan()).toBe("pro");
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).me.plan).toBe("pro");
  });
  it("cache honoured under 7 days, ignored after", () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now() - CACHE_MAX_AGE_MS + 1000, me: me("pro") }));
    useAccount.getState().setFromCache();
    expect(useAccount.getState().plan()).toBe("pro");
    useAccount.setState({ me: null });
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now() - CACHE_MAX_AGE_MS - 1, me: me("pro") }));
    useAccount.getState().setFromCache();
    expect(useAccount.getState().plan()).toBe("anon");
  });
  it("fresh refresh wins over cache", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), me: me("pro") }));
    useAccount.getState().setFromCache();
    useAiStore.setState({ client: { me: vi.fn().mockResolvedValue(me("free")) } as never });
    await useAccount.getState().refresh();
    expect(useAccount.getState().plan()).toBe("free");
  });
  it("storage throwing never crashes", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => useAccount.getState().setFromCache()).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: implement:**

```ts
// src/account/store.ts
import { create } from "zustand";
import type { MeResponse } from "../ai/client";
import type { Plan } from "./capabilities";
import { useAiStore } from "../store/ai";

export const CACHE_KEY = "pdfstudio.account";
export const CACHE_MAX_AGE_MS = 7 * 86400 * 1000;

interface AccountState { me: MeResponse | null; loading: boolean; error: string | null; refresh(): Promise<void>; clear(): void; setFromCache(): void; plan(): Plan }

export const useAccount = create<AccountState>((set, get) => ({
  me: null, loading: false, error: null,
  plan: () => get().me?.plan ?? "anon",
  async refresh() {
    const client = useAiStore.getState().client;
    if (!client) return;
    set({ loading: true, error: null });
    try {
      const me = await client.me();
      set({ me, loading: false });
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), me })); } catch { /* storage blocked */ }
    } catch (err) { set({ loading: false, error: (err as Error).message }); }
  },
  clear() { set({ me: null }); try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } },
  setFromCache() {
    if (get().me) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as { at: number; me: MeResponse };
      if (Date.now() - c.at < CACHE_MAX_AGE_MS) set({ me: c.me });
    } catch { /* ignore */ }
  },
}));
```

Hook-up in `ClerkBridge.tsx`:
- **On mount:** `setFromCache()`.
- **When `isSignedIn` becomes true:** `client.resetSession()`, then `refresh()`.
- **When it becomes false:** `clear()`, then `client.resetSession()`.
- **On `window` focus:** `refresh()` if signed in.

- [ ] **Step 4: PASS; commit `feat: useAccount store with 7-day offline cache`**

---

### Task 10: Design the account screens on the canvas

**Files:** none in the repo. This updates the Design artifact `https://claude.ai/artifact/DgMorKZ5L5gnDjvDH6H1Qq` (Quiet Desk canvas).

- [ ] **Step 1:** Add an `Accounts.dc.html` board (1792×1300) with:
  - the upgrade sheet, the Clerk sign-in modal restyle, the terms step (with `TERMS_CHECKBOX` copy) and the trial pill in the toolbar;
  - the paywall sheet (monthly/yearly toggle, $29 / $249) and the "Activating Pro…" notice;
  - the account menu (plan, dates, usage bars, Manage billing, Delete account, Sign out), the delete confirm dialog, a locked tool with its lock badge, the limit panel with "Upgrade to Pro", and the rollout banner.

  Use the existing tokens and the light theme. Add a dark variant of the paywall and the account menu to the dark row.
- [ ] **Step 2:** Show the canvas to the user and get explicit approval of the screens before Task 11. Record any copy changes back into this plan's Task 11 text.

---

### Task 11: Account UI components

**Files:**
- Create in `src/components/account/`:
  - `AccountMenu.tsx`, `TrialPill.tsx`, `TermsDialog.tsx`
  - `UpgradeSheet.tsx`, `PaywallSheet.tsx`, `ActivatingNotice.tsx`, `RolloutBanner.tsx`
  - `useGate.ts`
- Modify: `src/components/Toolbar.tsx` (avatar or Sign in, trial pill), `src/App.tsx` (mount TermsDialog, sheets, ActivatingNotice, RolloutBanner), `src/styles.css`
- Test: `src/components/account/*.test.tsx`

**Interfaces:**
- Consumes: `useAccount`, `can`, `paywallEnabled`, `TERMS_*`, `AiClient` methods, Clerk `SignInButton`/`useUser`/`useClerk`.
- Produces:
  - `useGate()` returns `{ require(feature: Feature): boolean }`. It returns true if allowed. Otherwise it opens the correct sheet (anon → UpgradeSheet, free → PaywallSheet) and returns false.
  - The sheet state lives in a small zustand store `useSheets` in `useGate.ts`, holding `{ open: "upgrade" | "paywall" | null }`.

Component behaviour:
- **Exact copy:** taken from spec "Screens" 1–8, plus the Task 10 approvals.
- **TermsDialog:**
  - shows when signed in, `me.termsAccepted === false` and `paywall` is true;
  - the Continue button is disabled until the checkbox is ticked;
  - Continue calls `acceptTerms(TERMS_VERSION)` and then `refresh()`;
  - it can't be dismissed except by Sign out.
- **PaywallSheet:**
  - the interval toggle defaults to yearly;
  - Subscribe calls `checkout(interval)` and then `location.assign(url)`;
  - on an error it shows "Couldn't start checkout. Try again."
- **ActivatingNotice:**
  - on load with `?checkout=success`, call `refresh()` every 3 s for up to 30 s, until `plan === "pro"`;
  - then show the toast "Pro is active" and remove the query parameter with `history.replaceState`;
  - after 30 s show "Payment received — Pro will appear shortly. Refresh in a minute.";
  - `?checkout=cancel` just removes the parameter.
- **AccountMenu:**
  - usage bars come from `me.usage` and `me.limits`;
  - Manage billing calls `portal()`, then `location.assign`;
  - Delete account opens a confirm dialog. Its button reads "Delete my account", it needs the user to type `DELETE`, and then it calls `deleteAccount()` followed by Clerk `signOut()`.
- **RolloutBanner:**
  - shows when `VITE_ROLLOUT_NOTICE` (a build var holding the date text) is non-empty;
  - it can be dismissed, and the dismissal is stored in `localStorage` (`pdfstudio.rolloutDismissed`) inside try/catch.

- [ ] **Step 1: Failing tests (one file per component; key cases):**

```tsx
// src/components/account/TermsDialog.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, it, expect } from "vitest";
import TermsDialog from "./TermsDialog";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";
import { TERMS_CHECKBOX, TERMS_VERSION } from "../../account/terms";

it("blocks Continue until the box is ticked, then accepts the current version", async () => {
  const acceptTerms = vi.fn().mockResolvedValue(undefined), me = vi.fn().mockResolvedValue({ plan: "trial", paywall: true, termsAccepted: true });
  useAiStore.setState({ client: { acceptTerms, me } as never });
  useAccount.setState({ me: { plan: "trial", paywall: true, termsAccepted: false } as never });
  render(<TermsDialog signedIn />);
  const btn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(TERMS_CHECKBOX));
  fireEvent.click(btn);
  await vi.waitFor(() => expect(acceptTerms).toHaveBeenCalledWith(TERMS_VERSION));
});
```

```tsx
// src/components/account/useGate.test.tsx
import { renderHook } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { useGate, useSheets } from "./useGate";
import { useAccount } from "../../account/store";
vi.mock("../../account/capabilities", async (orig) => ({ ...(await orig<typeof import("../../account/capabilities")>()), paywallEnabled: () => true }));

it.each([["anon", "upgrade"], ["free", "paywall"]] as const)("%s editing opens %s", (plan, sheet) => {
  useAccount.setState({ me: plan === "anon" ? null : ({ plan, paywall: true } as never) });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("edit")).toBe(false);
  expect(useSheets.getState().open).toBe(sheet);
});
it("trial edits freely", () => {
  useAccount.setState({ me: { plan: "trial", paywall: true } as never });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("edit")).toBe(true);
});
```

Add tests for:
- **PaywallSheet:** yearly is the default, and Subscribe calls `checkout("year")` and `location.assign`. Stub `location.assign` with `vi.spyOn(window.location, "assign")`, or inject a `navigate` prop that defaults to `location.assign`.
- **ActivatingNotice:** use fake timers. `refresh` is called up to 10 times; it stops when the plan becomes pro, and the fallback text appears after 30 s.
- **AccountMenu:** shows the usage numbers; "Delete my account" stays disabled until `DELETE` is typed.

- [ ] **Step 2: Run → FAIL. Step 3: implement the components (Quiet Desk classes, tokens only, accessible names as in tests). Step 4: tests, tsc, lint → PASS. Step 5: commit `feat: account, terms, upgrade and paywall UI`.**

---

### Task 12: Feature gates

**Files:**
- Modify:
  - `src/components/ToolPalette.tsx` (non-Select tools)
  - `src/components/FormLayer.tsx` (inputs read-only + click opens gate)
  - `src/components/Toolbar.tsx` (Download when `isDirty()`; rotate, delete and extract)
  - `src/components/ocr/DeepOcrMenu.tsx`
  - `src/components/live/VoiceTab.tsx` (Start)
  - `src/components/ai/AiPanel.tsx` (run buttons)
  - `src/store/live.ts` and `src/store/ai.ts` (map `account_required`, `pro_required`, `monthly_limit`)
- Test: extend each component's existing test file; new `e2e/account.spec.ts`

**Interfaces:**
- Consumes: `useGate().require(feature)`, `can`, `useAccount`.
- Produces: error messages:
  - `account_required` → "Create a free account to use this."
  - `pro_required` → "Deep OCR is part of Pro."
  - `monthly_limit` → "Monthly limit reached. Resets {date}."
  - `daily_limit` keeps its text.
  - In each limit panel, the free plan gets an "Upgrade to Pro" button that calls `useSheets.setState({ open: "paywall" })`.

- [ ] **Step 1: Failing unit tests (examples):**

```tsx
// src/components/ToolPalette.test.tsx (append)
it("with paywall on and plan free, choosing a draw tool opens the paywall instead of switching tool", async () => {
  vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
  useAccount.setState({ me: { plan: "free", paywall: true } as never });
  render(<ToolPalette />);
  fireEvent.click(screen.getByTestId("tool-ink"));
  expect(useToolsStore.getState().tool).toBe("select");
  expect(useSheets.getState().open).toBe("paywall");
  vi.unstubAllEnvs();
});
it("paywall off: tools switch as before", () => {
  render(<ToolPalette />);
  fireEvent.click(screen.getByTestId("tool-ink"));
  expect(useToolsStore.getState().tool).toBe("ink");
});
```

```ts
// src/store/live.test.ts (append)
it("account_required maps to the sign-up message", async () => {
  client.createLiveSession.mockRejectedValueOnce(new Error("account_required"));
  await useLiveStore.getState().start();
  expect(useLiveStore.getState().error).toBe("Create a free account to use this.");
});
```

```ts
// e2e/account.spec.ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const fixture = { name: "three.pdf", mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures/three.pdf")) };

for (const [plan, editable] of [["free", false], ["trial", true]] as const) {
  test(`plan ${plan}: editing ${editable ? "allowed" : "locked"}`, async ({ page }) => {
    await page.addInitScript((p) => { try { localStorage.setItem("pdfstudio.account", JSON.stringify({ at: Date.now(), me: { plan: p, paywall: true, termsAccepted: true } })); } catch {} }, plan);
    await page.route("**/me", (r) => r.fulfill({ json: { plan, paywall: true, termsAccepted: true } }));
    await page.goto("/?paywall=1");
    await page.setInputFiles('input[type="file"]', fixture);
    await page.getByTestId("tool-ink").click();
    if (editable) await expect(page.getByTestId("tool-ink")).toHaveAttribute("aria-pressed", "true");
    else await expect(page.getByRole("dialog", { name: /Pro/ })).toBeVisible();
  });
}
```

To let e2e run against the dev server with the paywall on, `paywallEnabled()` also returns true when `import.meta.env.DEV && new URLSearchParams(location.search).has("paywall")`. That covers dev only; production builds ignore the parameter. Add a unit test for this.

- [ ] **Step 2: Run → FAIL. Step 3: implement the gates:**
  - Every gate is `if (!require("edit")) return;` at the top of the action handler, or `"deepOcr"`, `"ai"` or `"voice"` as appropriate.
  - Locked controls get the class `locked`, which shows a 12 px lock badge via CSS. They are **not** `disabled`, so clicking them opens the sheet.
- [ ] **Step 4: All unit tests, tsc, lint, the full Playwright suite twice → PASS. Step 5: commit `feat: plan gates for editing, AI, Voice and Deep OCR`.**

---

### Task 13: Owner setup, terms page, rollout and launch

**Files:**
- Create: `public/terms.html`, `docs/accounts-setup.md`
- Modify: `.env.production`, `worker/wrangler.jsonc` (ids and vars), `README.md` (link to the setup doc)

- [ ] **Step 1: Draft `public/terms.html`.** It is a plain, Quiet Desk-styled static page. It covers:
  - general documentation tool; no identifiable patient information; use at your own risk;
  - AI processing by Anthropic and ElevenLabs only when the user invokes a feature;
  - subscription, cancellation and refunds through Stripe;
  - account deletion.

  Mark it "Draft — legal review recommended" in an HTML comment only. Ask the user to review the text.

- [ ] **Step 2: Write `docs/accounts-setup.md`** with the exact owner commands:

```bash
cd worker
npx wrangler d1 create pdfstudio            # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply pdfstudio --remote
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

  It also records which values go where:
  - **Worker vars:** `CLERK_ISSUER`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` (in `wrangler.jsonc`).
  - **App build vars:** `VITE_CLERK_PUBLISHABLE_KEY` (in `.env.production`).
  - **Stripe Dashboard:**
    - Product "PDF Studio Pro", with prices $29/month and $249/year.
    - Customer Portal on, with cancel at period end.
    - Webhook to `https://pdfstudio-ai.shemaiah7.workers.dev/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` and `invoice.paid`.
  - **Clerk:** Google + Email link enabled; allowed origin `https://pdfstudio.shemaiah7.workers.dev`.

- [ ] **Step 3: Accounts phase deploy (flag off).** Run, in order:
  1. Worker tests.
  2. `npm --prefix worker run deploy`.
  3. App tests.
  4. `npm run deploy` from a clean worktree of `origin/main`.
  5. Verify `/me` returns `{ plan: "anon", paywall: false }` for an anonymous session.
  6. Verify sign-in works live.

- [ ] **Step 4: Manual test-mode run** (Clerk dev + Stripe test keys on a preview deploy, or `wrangler dev` + `vite`):
  1. sign up → terms → trial pill;
  2. checkout with card `4242 4242 4242 4242` → "Activating Pro…" → Pro;
  3. Portal: cancel → still Pro until period end;
  4. `stripe trigger invoice.payment_failed` → still Pro (grace).

  Record the results in the PR.

- [ ] **Step 5: Notice.** Build with `VITE_ROLLOUT_NOTICE="From <date chosen by owner>, AI and editing need a free account."` and deploy. Keep it up for 7 days.

- [ ] **Step 6: Launch.** Set the Worker var `PAYWALL_ENABLED="true"` and `.env.production` `VITE_PAYWALL_ENABLED=true`, clear `VITE_ROLLOUT_NOTICE`, then run all tests and deploy the Worker and the app. Verify each of these live:
  - anonymous → Voice shows "Create a free account to use this.";
  - a trial account can edit;
  - a free test account sees the paywall on Edit text.

- [ ] **Step 7: Commit** each phase separately: `docs: accounts setup and terms draft`, `chore: enable paywall`.
