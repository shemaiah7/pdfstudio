# Desktop Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people sign in from the SentinelPDF desktop app — through their browser (one-time Clerk ticket handed back over a `sentinelpdf://signin` link) or with a 6-digit email code inside the app.

**Architecture:** The worker gains `POST /desktop/ticket` (Clerk session JWT → Clerk Backend API sign-in token). The Electron main process creates a single pending `state`, opens the browser at `/desktop-signin?state=…`, and accepts `sentinelpdf://signin?ticket&state` only with a matching unexpired state, passing the ticket to the page over IPC. The web app gets a desktop-only sign-in panel (browser button + email-code form), a root-level ticket listener that signs in with Clerk's `ticket` strategy, and a `/desktop-signin` browser page that confirms the account and hands back the ticket.

**Tech Stack:** Cloudflare Worker (vitest + `cloudflare:test`), Electron 44 (TypeScript 7 commonjs, vitest, Playwright `_electron`), React 19 + `@clerk/clerk-react` v5 + zustand + vitest/testing-library.

**Spec:** `docs/superpowers/specs/2026-10-16-desktop-signin-design.md`

## Global Constraints

- Ticket lifetime: `expires_in_seconds: 300`. Pending state lifetime: 10 minutes (600 000 ms). One pending sign-in at a time; a new start replaces the old.
- State format: 32 random bytes, base64url, no padding → exactly 43 chars matching `^[A-Za-z0-9_-]{43}$`.
- Ticket format accepted by the desktop parser: 1–4096 chars matching `^[A-Za-z0-9._~-]+$`.
- Link: `sentinelpdf://signin?ticket=<ticket>&state=<state>` — query, never fragment; exactly those two params.
- Rate limit: 5 tickets per user per minute → 429 `{ "error": "rate_limited" }`.
- Never log, print or persist a ticket or state (no `console.*` of them, no storage).
- Copy (verbatim): "Sign in to SentinelPDF", "Sign in with your browser", "Use an email code instead", "Google and email links open in your browser.", "Finish signing in in your browser…", "Cancel", "That sign-in link expired. Try again.", "Sign-in didn't finish. Try again.", "Too many tries. Wait a minute and try again.", "Sign-in isn't available right now. You can keep viewing PDFs.", "This sign-in link isn't valid. Start again from the SentinelPDF app.", "Sign in to the SentinelPDF app as", "Continue", "Not you? Switch account", "You're signed in. Return to SentinelPDF.", "Return to SentinelPDF", "Resend code", "Use a different email", "That code isn't right. Check the email or resend.".
- Website sign-in outside the desktop app is unchanged (Clerk modal via `SignInButton`/`SignUpButton`).
- Work only in `/Volumes/MelaninServer/pdfstudio-wt-signin` (branch `feat/desktop-signin`). Commit trailer: the committing model's `Co-Authored-By` line.
- Root checks after web changes: `npm run lint && npm run build && npm test`. Worker: `npm --prefix worker test`. Desktop: `cd desktop && npm run build && npx vitest run`.

## Review Focus

1. A ticket that arrives while the sign-in panel is closed (user closed it, or the page reloaded) must still sign the user in — the ticket listener lives at the app root, not in the panel. Pinned in Task 4 ("ticket handled with panel closed").
2. A ticket that arrives before Clerk has loaded (`isLoaded === false`) must be held and used once Clerk loads, not dropped. Pinned in Task 4 ("waits for Clerk to load").
3. Clicking "Return to SentinelPDF" twice delivers the link twice; the second is rejected as consumed. If the user is already signed in, that `signin-failed` must not show an error. Pinned in Task 3 (desktop: second link rejected) and Task 4 (panel ignores `expired` when signed in).
4. Emails typed with surrounding spaces or capitals ("  Me@Example.COM ") must work — trim before calling Clerk. Pinned in Task 4.
5. Opening `/desktop-signin` with no `state`, a short `state`, or extra junk must show the invalid-link message and never call the worker. Pinned in Task 5.

---

### Task 1: Worker `POST /desktop/ticket`

**Files:**
- Create: `worker/src/handlers/desktopTicket.ts`, `worker/test/desktopTicket.test.ts`
- Modify: `worker/src/index.ts` (route), `worker/src/clerk.ts` (add `createSignInToken`), `docs/accounts-setup.md` (owner step), `worker/README.md` (endpoint list)

**Interfaces:**
- Produces: `POST /desktop/ticket` — request header `Authorization: Bearer <Clerk session JWT>`; responses `200 { ticket: string }` (+ `cache-control: no-store`), `401 { error: "unauthorized" }`, `429 { error: "rate_limited" }`, `503 { error: "accounts_unavailable" }`, `502 { error: "upstream" }`.
- Produces: `createSignInToken(userId: string, env: Env, fetchFn?: typeof fetch): Promise<string>` in `worker/src/clerk.ts`.

- [ ] **Step 1: Write the failing tests** — `worker/test/desktopTicket.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { setJwksForTest } from "../src/clerk";
import { desktopTicketHandler, configureDesktopTicketFetch } from "../src/handlers/desktopTicket";
import { makeSigner, good } from "./jwt-helpers";

let sign: (p: Record<string, unknown>) => Promise<string>;
beforeAll(async () => { const s = await makeSigner(); sign = s.sign; setJwksForTest([s.jwk]); });

const calls: { url: string; init: RequestInit }[] = [];
const okFetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ token: "tkt_abc", status: "pending" }), { status: 200 }); }) as unknown as typeof fetch;
afterEach(() => { calls.length = 0; configureDesktopTicketFetch(okFetch); });

const post = (auth: string | null, e = env) => desktopTicketHandler(new Request("https://ai.example/desktop/ticket", { method: "POST", headers: auth ? { authorization: `Bearer ${auth}` } : {} }), { ...e, ALLOWED_ORIGIN: "http://localhost:5173" });

describe("POST /desktop/ticket", () => {
  it("401 without a token or with a bad one", async () => {
    configureDesktopTicketFetch(okFetch);
    expect((await post(null)).status).toBe(401);
    expect((await post("not.a.jwt")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("issues a 300 s ticket for the caller only, no-store", async () => {
    configureDesktopTicketFetch(okFetch);
    const res = await post(await sign({ ...good(), sub: "user_t1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ticket: "tkt_abc" });
    expect(calls[0].url).toBe("https://api.clerk.com/v1/sign_in_tokens");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ user_id: "user_t1", expires_in_seconds: 300 });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${env.CLERK_SECRET_KEY}`);
  });
  it("429 on the 6th ticket in a minute", async () => {
    configureDesktopTicketFetch(okFetch);
    const t = await sign({ ...good(), sub: "user_rl" });
    for (let i = 0; i < 5; i++) expect((await post(t)).status).toBe(200);
    const r = await post(t);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rate_limited" });
  });
  it("503 when accounts are not configured", async () => {
    const r = await post(await sign(good()), { ...env, CLERK_SECRET_KEY: "" });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "accounts_unavailable" });
  });
  it("502 on a Clerk error without echoing its body", async () => {
    configureDesktopTicketFetch((async () => new Response("secret clerk detail", { status: 500 })) as unknown as typeof fetch);
    const r = await post(await sign({ ...good(), sub: "user_err" }));
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("secret clerk detail");
  });
});
```

- [ ] **Step 2: Run** — `npm --prefix worker test -- desktopTicket` → FAIL (module missing).

- [ ] **Step 3: Implement.** Append to `worker/src/clerk.ts`:

```ts
/** One-time sign-in token (Clerk Backend API) for the desktop browser hand-off. Valid 300 s, single use. */
export async function createSignInToken(userId: string, env: Env, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${CLERK_API}/sign_in_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
  });
  if (!res.ok) throw new Error(`clerk_${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("clerk_no_token");
  return body.token;
}
```

`worker/src/handlers/desktopTicket.ts`:

```ts
import type { Env } from "../env";
import { json } from "../cors";
import { verifyClerkJwt, createSignInToken } from "../clerk";

let fetchFn: typeof fetch = (input, init) => fetch(input, init);
export function configureDesktopTicketFetch(f: typeof fetch): void { fetchFn = f; }

const LIMIT_PER_MINUTE = 5;

export async function desktopTicketHandler(request: Request, env: Env): Promise<Response> {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_ISSUER) return json({ error: "accounts_unavailable" }, 503, env);
  const a = request.headers.get("authorization") ?? "";
  const claims = a.startsWith("Bearer ") ? await verifyClerkJwt(a.slice(7), env).catch(() => null) : null;
  if (!claims) return json({ error: "unauthorized" }, 401, env);
  const key = `dt:${claims.sub}:${Math.floor(Date.now() / 60000)}`;
  const used = Number((await env.QUOTA.get(key)) ?? "0");
  if (used >= LIMIT_PER_MINUTE) return json({ error: "rate_limited" }, 429, env);
  await env.QUOTA.put(key, String(used + 1), { expirationTtl: 120 });
  try {
    const ticket = await createSignInToken(claims.sub, env, fetchFn);
    return json({ ticket }, 200, env, { "cache-control": "no-store" });
  } catch {
    return json({ error: "upstream" }, 502, env);
  }
}
```

In `worker/src/index.ts` import it and add `"/desktop/ticket": (r, env) => desktopTicketHandler(r, env),` to `routes`. In `docs/accounts-setup.md` add under the Clerk section: "**Desktop sign-in:** in the Clerk dashboard → User & authentication → Email, turn on **Email verification code** for sign-in and sign-up (keep the magic link and Google). The desktop app's browser hand-off uses one-time sign-in tokens, which need only the `CLERK_SECRET_KEY` secret you already set." Add `POST /desktop/ticket` to the endpoint list in `worker/README.md`.

- [ ] **Step 4: Run** — `npm --prefix worker test` → all pass (existing 226 + 5 new).

- [ ] **Step 5: Commit** — `feat(worker): one-time desktop sign-in tickets`.

---

### Task 2: Desktop sign-in rules (pure)

**Files:**
- Create: `desktop/src/signin.ts`, `desktop/test/signin.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PendingSignIn { state: string; expiresAt: number }
export const SIGNIN_TTL_MS = 600_000;
export function createPendingSignIn(now: number, random: (n: number) => Uint8Array): PendingSignIn;
export function signInLinkFrom(url: string): { ticket: string; state: string } | null;
export function consumeSignIn(pending: PendingSignIn | null, link: { state: string }, now: number): "ok" | "mismatch" | "expired";
```

- [ ] **Step 1: Write the failing tests** — `desktop/test/signin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createPendingSignIn, signInLinkFrom, consumeSignIn, SIGNIN_TTL_MS } from "../src/signin";

const S = "A".repeat(43);
const rnd = (n: number) => new Uint8Array(n).fill(7);

describe("createPendingSignIn", () => {
  it("makes a 43-char base64url state that expires in 10 minutes", () => {
    const p = createPendingSignIn(1000, rnd);
    expect(p.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.expiresAt).toBe(1000 + SIGNIN_TTL_MS);
  });
});

describe("signInLinkFrom", () => {
  it("reads ticket and state from the query", () => {
    expect(signInLinkFrom(`sentinelpdf://signin?ticket=tkt_abc.1-2~x&state=${S}`)).toEqual({ ticket: "tkt_abc.1-2~x", state: S });
    expect(signInLinkFrom(`SENTINELPDF://SIGNIN/?ticket=t&state=${S}`)).toEqual({ ticket: "t", state: S });
  });
  it("rejects anything else", () => {
    for (const u of [
      `sentinelpdf://owner?ticket=t&state=${S}`,
      `sentinelpdf://signin?state=${S}`,
      "sentinelpdf://signin?ticket=t",
      `sentinelpdf://signin?ticket=t&state=${S}&x=1`,
      "sentinelpdf://signin?ticket=t&state=short",
      `sentinelpdf://signin#ticket=t&state=${S}`,
      `sentinelpdf://signin?ticket=${"a".repeat(4097)}&state=${S}`,
      `sentinelpdf://signin?ticket=bad%20space&state=${S}`,
      `https://sentinelpdf.com/?ticket=t&state=${S}`,
      "not a url",
    ]) expect(signInLinkFrom(u)).toBeNull();
  });
});

describe("consumeSignIn", () => {
  const p = { state: S, expiresAt: 5000 };
  it("ok only for the matching unexpired state", () => {
    expect(consumeSignIn(p, { state: S }, 4999)).toBe("ok");
    expect(consumeSignIn(p, { state: "B".repeat(43) }, 10)).toBe("mismatch");
    expect(consumeSignIn(p, { state: S }, 5000)).toBe("expired");
    expect(consumeSignIn(null, { state: S }, 10)).toBe("mismatch");
  });
});
```

- [ ] **Step 2: Run** — `cd desktop && npx vitest run test/signin.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `desktop/src/signin.ts`:

```ts
import { LINK_SCHEME } from "./rules";

export interface PendingSignIn { state: string; expiresAt: number }
export const SIGNIN_TTL_MS = 600_000;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const TICKET_RE = /^[A-Za-z0-9._~-]{1,4096}$/;

export function createPendingSignIn(now: number, random: (n: number) => Uint8Array): PendingSignIn {
  const state = Buffer.from(random(32)).toString("base64url");
  return { state, expiresAt: now + SIGNIN_TTL_MS };
}

/** { ticket, state } from sentinelpdf://signin?ticket=…&state=…, or null for anything else. */
export function signInLinkFrom(url: string): { ticket: string; state: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${LINK_SCHEME}:` || u.host.toLowerCase() !== "signin") return null;
  if (u.pathname !== "" && u.pathname !== "/") return null;
  if (u.hash) return null;
  const keys = [...u.searchParams.keys()].sort();
  if (keys.length !== 2 || keys[0] !== "state" || keys[1] !== "ticket") return null;
  const ticket = u.searchParams.get("ticket") ?? "", state = u.searchParams.get("state") ?? "";
  if (!TICKET_RE.test(ticket) || !STATE_RE.test(state)) return null;
  return { ticket, state };
}

export function consumeSignIn(pending: PendingSignIn | null, link: { state: string }, now: number): "ok" | "mismatch" | "expired" {
  if (!pending || pending.state !== link.state) return "mismatch";
  return now < pending.expiresAt ? "ok" : "expired";
}
```

(`Buffer` is available in Electron main; base64url of 32 bytes is exactly 43 chars.)

- [ ] **Step 4: Run** — `cd desktop && npx vitest run && npm run build` → PASS.

- [ ] **Step 5: Commit** — `feat(desktop): sign-in link and state rules`.

---

### Task 3: Desktop wiring (main, preload, bridge types, smoke) — version 1.0.4

**Files:**
- Modify: `desktop/src/main.ts`, `desktop/src/preload.ts`, `desktop/src/rules.ts` (`linkFromArgv` already returns any `sentinelpdf:` arg — keep), `src/desktop/bridge.ts`, `desktop/package.json` (`1.0.4`, refresh lockfile with `npm install --package-lock-only`)
- Create: `desktop/test/signin.e2e.ts`

**Interfaces:**
- Consumes: Task 2 functions.
- Produces (preload, on `window.sentinelDesktop`): `startBrowserSignIn(): void`, `onSignInTicket(cb: (ticket: string) => void): () => void`, `onSignInFailed(cb: (reason: "expired") => void): () => void`. IPC: renderer→main `sentinel:start-browser-signin`; main→renderer `sentinel:signin-ticket` (string), `sentinel:signin-failed` (`"expired"`).
- Produces (`src/desktop/bridge.ts`): `DesktopBridge` gains optional `startBrowserSignIn?(): void; onSignInTicket?(cb: (ticket: string) => void): () => void; onSignInFailed?(cb: (reason: "expired") => void): () => void;` and helper `export const canBrowserSignIn = (): boolean => typeof desktopBridge()?.startBrowserSignIn === "function";`

- [ ] **Step 1: Write the failing smoke test** — `desktop/test/signin.e2e.ts`:

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

test("browser sign-in: matching state delivers the ticket once", async () => {
  const app = await electron.launch({ args: [resolve(__dirname, "..")], env: { ...process.env, SENTINEL_APP_URL: "https://pdfstudio.shemaiah7.workers.dev", SENTINEL_TEST_NO_BROWSER: "1" } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.evaluate(() => {
      const w = window as unknown as { sentinelDesktop: { onSignInTicket(cb: (t: string) => void): void; onSignInFailed(cb: (r: string) => void): void; startBrowserSignIn(): void }; __got: string[]; __failed: string[] };
      w.__got = []; w.__failed = [];
      w.sentinelDesktop.onSignInTicket((t) => w.__got.push(t));
      w.sentinelDesktop.onSignInFailed((r) => w.__failed.push(r));
      w.sentinelDesktop.startBrowserSignIn();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl?: string }).__sentinelLastSignInUrl ?? "")).toContain("/desktop-signin?state=");
    const opened = await app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl);
    const state = new URL(opened).searchParams.get("state")!;
    const link = `sentinelpdf://signin?ticket=tkt_test&state=${state}`;
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, link);
    await expect.poll(() => win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_test"]);
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, link);
    await expect.poll(() => win.evaluate(() => (window as unknown as { __failed: string[] }).__failed)).toEqual(["expired"]);
    expect(await win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_test"]);
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  }
});
```

- [ ] **Step 2: Run** — `cd desktop && npm run build && npx playwright test test/signin.e2e.ts` → FAIL (no `startBrowserSignIn`). (Quit any running SentinelPDF first; it holds the single-instance lock.)

- [ ] **Step 3: Implement.**

`desktop/src/preload.ts` — add listener sets and expose:

```ts
const ticketListeners = new Set<(t: string) => void>();
const failedListeners = new Set<(r: "expired") => void>();
ipcRenderer.on("sentinel:signin-ticket", (_e: IpcRendererEvent, t: string) => { for (const cb of ticketListeners) cb(t); });
ipcRenderer.on("sentinel:signin-failed", (_e: IpcRendererEvent, r: "expired") => { for (const cb of failedListeners) cb(r); });
// inside exposeInMainWorld("sentinelDesktop", { ... }):
  startBrowserSignIn: () => ipcRenderer.send("sentinel:start-browser-signin"),
  onSignInTicket(cb: (t: string) => void) { ticketListeners.add(cb); return () => { ticketListeners.delete(cb); }; },
  onSignInFailed(cb: (r: "expired") => void) { failedListeners.add(cb); return () => { failedListeners.delete(cb); }; },
```

`desktop/src/main.ts`:
- `import { randomBytes } from "node:crypto";` and `import { createPendingSignIn, signInLinkFrom, consumeSignIn, type PendingSignIn } from "./signin";`
- Module state: `let pendingSignIn: PendingSignIn | null = null;`
- Function:

```ts
async function startBrowserSignIn(): Promise<void> {
  pendingSignIn = createPendingSignIn(Date.now(), (n) => new Uint8Array(randomBytes(n)));
  const target = new URL("/desktop-signin", url);
  target.searchParams.set("state", pendingSignIn.state);
  if (!app.isPackaged && process.env.SENTINEL_TEST_NO_BROWSER === "1") { (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl = target.toString(); return; }
  await shell.openExternal(target.toString()).catch(() => {});
}

async function handleSignInLink(link: string): Promise<boolean> {
  const parsed = signInLinkFrom(link);
  if (!parsed) return false;
  await app.whenReady();
  if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.focus(); }
  const result = consumeSignIn(pendingSignIn, parsed, Date.now());
  if (result === "ok") { pendingSignIn = null; win?.webContents.send("sentinel:signin-ticket", parsed.ticket); }
  else win?.webContents.send("sentinel:signin-failed", "expired");
  return true;
}
```

- A single dispatcher used by `open-url`, `second-instance` and first-launch argv: `async function handleLink(link: string) { if (await handleSignInLink(link)) return; await handleOwnerLink(link); }` — replace the existing direct `handleOwnerLink` calls with `handleLink`.
- `ipcMain.on("sentinel:start-browser-signin", (e) => { if (win && e.sender === win.webContents) void startBrowserSignIn(); });`
- Cold start from a `signin` link: the app was closed, so there is no pending state and the result is `mismatch`; the failure message may arrive before the page listens and be dropped. That's acceptable — the user starts sign-in again from the open app. Don't add a queue.

`src/desktop/bridge.ts` — extend `DesktopBridge` with the three optional members and add `canBrowserSignIn` as in Interfaces.

Bump `desktop/package.json` to `1.0.4`; `cd desktop && npm install --package-lock-only`.

- [ ] **Step 4: Run** — `cd desktop && npm run build && npx vitest run && npx playwright test` (both e2e files) → PASS; root `npm run lint && npm run build && npm test` → PASS.

- [ ] **Step 5: Commit** — `feat(desktop): browser sign-in hand-off (1.0.4)`.

---

### Task 4: Desktop sign-in panel and root ticket listener (web)

**Files:**
- Create: `src/account/desktopSignIn.ts` (zustand store), `src/components/account/DesktopSignInPanel.tsx`, `src/components/account/DesktopSignInPanel.test.tsx`, `src/components/account/SignInTrigger.tsx`, `src/components/account/SignInTrigger.test.tsx`
- Modify: `src/components/account/AccountEntry.tsx`, `src/components/account/UpgradeSheet.tsx` (use `SignInTrigger`), `src/main.tsx` (mount panel + listener inside `ClerkProvider`), `src/styles.css` (panel styles using tokens)

**Interfaces:**
- Consumes: `isDesktop`, `desktopBridge`, `canBrowserSignIn` from `src/desktop/bridge.ts` (Task 3).
- Produces:

```ts
// src/account/desktopSignIn.ts
export type PanelStep = "choose" | "waiting" | "email" | "code" | "unavailable";
interface DesktopSignInState { open: boolean; step: PanelStep; error: string | null; openPanel(): void; close(): void; setStep(s: PanelStep): void; setError(e: string | null): void }
export const useDesktopSignIn: import("zustand").UseBoundStore<import("zustand").StoreApi<DesktopSignInState>>;
// src/components/account/SignInTrigger.tsx
export default function SignInTrigger(props: { mode: "sign-in" | "sign-up"; children: React.ReactElement; onBeforeOpen?: () => void }): JSX.Element;
// src/components/account/DesktopSignInPanel.tsx
export function DesktopTicketListener(): null;   // mounted once at the root, inside ClerkProvider
export default function DesktopSignInPanel(): JSX.Element | null; // renders when useDesktopSignIn.open
```

- [ ] **Step 1: Write the failing tests.** Mock Clerk with `vi.mock("@clerk/clerk-react", …)` exposing `useSignIn`, `useSignUp`, `useAuth`, `SignInButton`, `SignUpButton`. Put `window.sentinelDesktop` in place per test (delete in `afterEach`). `src/components/account/DesktopSignInPanel.test.tsx` must cover:

```ts
// 1 choose → browser: clicking "Sign in with your browser" calls sentinelDesktop.startBrowserSignIn and shows "Finish signing in in your browser…"; "Cancel" returns to choose.
// 2 ticket handled with panel closed: with DesktopTicketListener mounted and the panel closed, firing the bridge's onSignInTicket callback with "tkt" calls signIn.create({ strategy: "ticket", ticket: "tkt" }) then setActive({ session: "sess_1" }) (create resolves { status: "complete", createdSessionId: "sess_1" }), and closes the panel.
// 3 waits for Clerk to load: useSignIn returns { isLoaded: false } first; a ticket fired then is not used; after rerender with isLoaded: true, signIn.create is called once with that ticket.
// 4 ticket rejected by Clerk (create rejects): panel shows "Sign-in didn't finish. Try again." on the choose step.
// 5 signin-failed "expired": signed out → panel shows "That sign-in link expired. Try again."; signed in (useAuth isSignedIn true) → no error shown.
// 6 email code, existing account: typing "  Me@Example.COM " and submitting calls signIn.create({ identifier: "me@example.com" }) then prepareFirstFactor({ strategy: "email_code", emailAddressId: "idn_1" }) (supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }]); entering "123456" calls attemptFirstFactor({ strategy: "email_code", code: "123456" }) and setActive with its createdSessionId.
// 7 email code, new account: signIn.create rejects with { errors: [{ code: "form_identifier_not_found" }] } → signUp.create({ emailAddress: "new@x.y" }) and signUp.prepareEmailAddressVerification({ strategy: "email_code" }); code → signUp.attemptEmailAddressVerification({ code }) and setActive.
// 8 wrong code: attemptFirstFactor rejects with { errors: [{ code: "form_code_incorrect" }] } → "That code isn't right. Check the email or resend."
// 9 Resend is disabled for 30 s after sending (fake timers), then calls prepareFirstFactor again; "Use a different email" returns to the email step.
// 10 older desktop app without startBrowserSignIn: the panel opens straight on the email step and shows no browser button.
// 11 never logs the ticket: spy console.log/warn/error during cases 2 and 6 and assert no call contains "tkt".
```

Write each as a real `it(...)` with `render`, `fireEvent`, `waitFor` (follow `src/components/account/UpgradeSheet.test.tsx` and `useGate.test.tsx` for mocking style). `src/components/account/SignInTrigger.test.tsx`: outside desktop it renders Clerk's `SignInButton`/`SignUpButton` (mocked to render a marker wrapper); inside desktop, clicking the child opens `useDesktopSignIn` (`open === true`) and calls `onBeforeOpen`.

- [ ] **Step 2: Run** — `npx vitest run src/components/account/DesktopSignInPanel.test.tsx src/components/account/SignInTrigger.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**

`src/account/desktopSignIn.ts`:

```ts
import { create } from "zustand";
export type PanelStep = "choose" | "waiting" | "email" | "code" | "unavailable";
interface DesktopSignInState { open: boolean; step: PanelStep; error: string | null; openPanel(): void; close(): void; setStep(s: PanelStep): void; setError(e: string | null): void }
export const useDesktopSignIn = create<DesktopSignInState>((set) => ({
  open: false, step: "choose", error: null,
  openPanel: () => set({ open: true, step: "choose", error: null }),
  close: () => set({ open: false, error: null }),
  setStep: (step) => set({ step, error: null }),
  setError: (error) => set({ error }),
}));
```

`src/components/account/SignInTrigger.tsx`:

```tsx
import { cloneElement, type ReactElement } from "react";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import { isDesktop } from "../../desktop/bridge";
import { useDesktopSignIn } from "../../account/desktopSignIn";

/** Clerk's modal on the web; the desktop sign-in panel inside the desktop app (Google and magic links can't complete in an app window). */
export default function SignInTrigger({ mode, children, onBeforeOpen }: { mode: "sign-in" | "sign-up"; children: ReactElement<{ onClick?: () => void }>; onBeforeOpen?: () => void }) {
  if (isDesktop()) return cloneElement(children, { onClick: () => { onBeforeOpen?.(); useDesktopSignIn.getState().openPanel(); } });
  return mode === "sign-up" ? <SignUpButton mode="modal">{children}</SignUpButton> : <SignInButton mode="modal">{children}</SignInButton>;
}
```

Replace `SignInButton`/`SignUpButton` usages in `AccountEntry.tsx` and `UpgradeSheet.tsx` with `<SignInTrigger mode="sign-in"|"sign-up">…</SignInTrigger>` (UpgradeSheet passes its `close` as `onBeforeOpen` instead of putting it on the child's onClick).

`src/components/account/DesktopSignInPanel.tsx` — implement:
- `DesktopTicketListener`: `useSignIn()` and `useAuth()`. On mount subscribe `desktopBridge()?.onSignInTicket?.(t => pending.current = t; trigger)` and `onSignInFailed?.(r => if (!isSignedIn) { openPanel if closed; setStep("choose"); setError("That sign-in link expired. Try again.") })`. A `useEffect` keyed on `[isLoaded, tick]` consumes `pending.current` when `isLoaded`: `const r = await signIn.create({ strategy: "ticket", ticket }); if (r.status === "complete") { await setActive({ session: r.createdSessionId }); close(); } else throw …`; on any error `openPanel(); setStep("choose"); setError("Sign-in didn't finish. Try again.")`. Clear `pending.current` before awaiting (single use). No logging of the ticket.
- `DesktopSignInPanel`: renders `<Sheet title="Sign in to SentinelPDF" onClose={close}>` when `open`. On open, if `!canBrowserSignIn()` jump to `"email"`. Steps:
  - choose: primary button "Sign in with your browser" → `desktopBridge()?.startBrowserSignIn?.(); setStep("waiting")`; link button "Use an email code instead" → `setStep("email")`; note "Google and email links open in your browser."; error line if set (role="alert").
  - waiting: "Finish signing in in your browser…", buttons "Cancel" (→ choose) and "Use an email code instead".
  - email: `<input type="email" autoComplete="email">`, submit → `const email = value.trim().toLowerCase()`; try `signIn.create({ identifier: email })`, find `supportedFirstFactors` entry with `strategy === "email_code"`, `prepareFirstFactor({ strategy: "email_code", emailAddressId })`, mode "signIn", → code. If the error's `errors?.[0]?.code === "form_identifier_not_found"`: `signUp.create({ emailAddress: email })`, `signUp.prepareEmailAddressVerification({ strategy: "email_code" })`, mode "signUp", → code. Other errors → `setError(e.errors?.[0]?.longMessage ?? "Sign-in isn't available right now. You can keep viewing PDFs.")`.
  - code: `<input inputMode="numeric" autoComplete="one-time-code" maxLength={6}>`; submit → signIn: `attemptFirstFactor({ strategy: "email_code", code })`; signUp: `attemptEmailAddressVerification({ code })`; on `status === "complete"` → `setActive({ session: createdSessionId })`, close. Error `form_code_incorrect` (or any code error) → "That code isn't right. Check the email or resend." "Resend code" disabled for 30 s after each send (setTimeout), re-runs the prepare call. "Use a different email" → email step.
  - unavailable: "Sign-in isn't available right now. You can keep viewing PDFs." (shown if `useSignIn` never loads within 10 s of opening).
- Styles in `src/styles.css`: `.dsi-*` classes using existing tokens and the existing `sigPrimary` / `acct-link` button classes; 16px gutters; works at 375 px.

`src/main.tsx`: inside the `ClerkProvider` branch, after `<ClerkBridge />`, render `<DesktopTicketListener />` and `<DesktopSignInPanel />` (both render nothing outside the desktop app — guard with `isDesktop()` at the top of each).

- [ ] **Step 4: Run** — targeted tests PASS; then `npm run lint && npm run build && npm test` PASS.

- [ ] **Step 5: Commit** — `feat(account): desktop sign-in panel (browser hand-off + email code)`.

---

### Task 5: `/desktop-signin` browser page

**Files:**
- Create: `src/account/DesktopSignInPage.tsx`, `src/account/DesktopSignInPage.test.tsx`, `src/account/desktopTicket.ts` (fetch helper), `src/account/desktopTicket.test.ts`
- Modify: `src/main.tsx` (route by pathname), `src/styles.css`

**Interfaces:**
- Consumes: worker `POST /desktop/ticket` (Task 1); `VITE_AI_URL` base as in `src/components/ai/useAiClient.ts:14`.
- Produces:

```ts
// src/account/desktopTicket.ts
export const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
export function stateFromSearch(search: string): string | null; // exactly one param "state" matching STATE_RE, else null
export function appLink(ticket: string, state: string): string; // `sentinelpdf://signin?ticket=${encodeURIComponent(ticket)}&state=${state}`
export async function fetchDesktopTicket(baseUrl: string, jwt: string, fetchFn?: typeof fetch): Promise<{ ticket: string } | { error: "rate_limited" | "unauthorized" | "accounts_unavailable" | "upstream" }>;
```

- [ ] **Step 1: Write the failing tests.**

`src/account/desktopTicket.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { stateFromSearch, appLink, fetchDesktopTicket } from "./desktopTicket";
const S = "A".repeat(43);
describe("stateFromSearch", () => {
  it("accepts exactly one valid state", () => { expect(stateFromSearch(`?state=${S}`)).toBe(S); });
  it("rejects missing, short, junk or extra params", () => {
    for (const s of ["", "?", "?state=short", `?state=${S}&x=1`, `?state=${S}!`, "?ticket=1"]) expect(stateFromSearch(s)).toBeNull();
  });
});
describe("appLink", () => {
  it("puts ticket and state in the query", () => { expect(appLink("t.k-~_", S)).toBe(`sentinelpdf://signin?ticket=t.k-~_&state=${S}`); });
});
describe("fetchDesktopTicket", () => {
  it("posts with the bearer token and returns the ticket", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ticket: "tkt" }), { status: 200 }));
    expect(await fetchDesktopTicket("https://ai.x", "jwt1", f as unknown as typeof fetch)).toEqual({ ticket: "tkt" });
    expect(f).toHaveBeenCalledWith("https://ai.x/desktop/ticket", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer jwt1" }) }));
  });
  it("maps errors", async () => {
    for (const [status, error] of [[429, "rate_limited"], [401, "unauthorized"], [503, "accounts_unavailable"], [502, "upstream"]] as const) {
      const f = vi.fn(async () => new Response(JSON.stringify({ error }), { status }));
      expect(await fetchDesktopTicket("https://ai.x", "j", f as unknown as typeof fetch)).toEqual({ error });
    }
  });
});
```

`src/account/DesktopSignInPage.test.tsx` (mock `@clerk/clerk-react`: `useAuth`, `useUser`, `useClerk`, `SignIn`):
- invalid state (`window.history.replaceState({}, "", "/desktop-signin?state=short")`) → shows "This sign-in link isn't valid. Start again from the SentinelPDF app." and `fetch` is never called;
- signed out with a valid state → renders the mocked `<SignIn>`;
- signed in → shows "Sign in to the SentinelPDF app as" with the user's email, "Continue", "Not you? Switch account";
- Continue → calls `fetchDesktopTicket` (spy `global.fetch`) with `getToken()`'s JWT, then sets `window.location.href` to `sentinelpdf://signin?ticket=tkt&state=<S>` (stub `location.assign` / spy a `navigate` prop) and shows "You're signed in. Return to SentinelPDF." with a "Return to SentinelPDF" button that re-navigates to the same link;
- 429 → "Too many tries. Wait a minute and try again."; other errors → "Sign-in isn't available right now. You can keep viewing PDFs.";
- "Not you? Switch account" calls `signOut()` and returns to the sign-in view.

- [ ] **Step 2: Run** — `npx vitest run src/account/desktopTicket.test.ts src/account/DesktopSignInPage.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**

`src/account/desktopTicket.ts` per Interfaces:

```ts
export const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
export function stateFromSearch(search: string): string | null {
  const p = new URLSearchParams(search);
  const keys = [...p.keys()];
  if (keys.length !== 1 || keys[0] !== "state") return null;
  const s = p.get("state") ?? "";
  return STATE_RE.test(s) ? s : null;
}
export const appLink = (ticket: string, state: string): string => `sentinelpdf://signin?ticket=${encodeURIComponent(ticket)}&state=${state}`;
type TicketError = "rate_limited" | "unauthorized" | "accounts_unavailable" | "upstream";
export async function fetchDesktopTicket(baseUrl: string, jwt: string, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<{ ticket: string } | { error: TicketError }> {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/desktop/ticket`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { ticket?: string; error?: TicketError };
    if (res.ok && body.ticket) return { ticket: body.ticket };
    return { error: body.error ?? (res.status === 429 ? "rate_limited" : res.status === 401 ? "unauthorized" : res.status === 503 ? "accounts_unavailable" : "upstream") };
  } catch { return { error: "upstream" }; }
}
```

`src/account/DesktopSignInPage.tsx`: a full-page Quiet Desk layout (mark `/brand/mark-small.svg` + "SentinelPDF" header like `/download`), states:
- `state === null` → invalid message only.
- `!isLoaded` → nothing (Clerk loading).
- `!isSignedIn` → `<SignIn routing="hash" forceRedirectUrl={window.location.href} />` (Google and magic link return here with the query intact).
- signed in, idle → "Sign in to the SentinelPDF app as **{email}**", primary "Continue", link "Not you? Switch account" (`signOut({ redirectUrl: window.location.href })`).
- Continue → `const jwt = await getToken(); const r = await fetchDesktopTicket(base, jwt ?? "")`; ticket → `navigate(appLink(r.ticket, state))` (prop `navigate = (u) => { window.location.href = u; }` for tests), show done state with "Return to SentinelPDF" that calls `navigate` with the same link; errors as in the test list. `base` = `import.meta.env.VITE_AI_URL || (import.meta.env.DEV ? "http://localhost:8787" : "")`.
- Never log the ticket.

`src/main.tsx`: `const isDesktopSignInPage = location.pathname === "/desktop-signin";` In the Clerk branch render `<ClerkProvider …>{isDesktopSignInPage ? <DesktopSignInPage /> : (<><ClerkBridge /><DesktopTicketListener /><DesktopSignInPanel /><App /></>)}</ClerkProvider>`. Without a Clerk key (accounts off), `/desktop-signin` renders a static page with "Sign-in isn't available right now. You can keep viewing PDFs." instead of the app. Don't register the service worker differently (it only caches `/`).

- [ ] **Step 4: Run** — targeted tests PASS; `npm run lint && npm run build && npm test` PASS. `npx vite preview` and open `/desktop-signin?state=short` → invalid message renders (Cloudflare's SPA fallback serves index.html for this path in production, as it does for `/terms` routing; confirm `wrangler.jsonc` `not_found_handling: single-page-application`).

- [ ] **Step 5: Commit** — `feat(account): /desktop-signin browser page`.

---

## Release notes for the controller (not a task)

After merge: deploy worker (new route), deploy app, tag `desktop-v1.0.4`. Real sign-in can only be tested after the owner creates the Clerk application and turns on "Email verification code" (docs/accounts-setup.md); until then accounts stay off and none of this UI renders on the web or in the desktop app.
