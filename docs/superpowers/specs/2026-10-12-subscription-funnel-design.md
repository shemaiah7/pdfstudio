# Accounts and subscription funnel — design

Date: 2026-10-12 · Status: approved in conversation, pending spec review

## Goal

Turn PDF Studio into a paid product with a simple funnel: anonymous visitors can view PDFs, a free
account unlocks a 7-day full trial and then a small daily allowance, and one paid plan (**Pro**) unlocks
editing and full AI, Voice and Deep OCR. Keep the existing Cloudflare setup (static app Worker, AI Worker,
Turnstile, KV quotas) and add accounts and billing on top.

### Positioning and liability (decided)

- PDF Studio is a **general documentation tool** for professionals, including the medical field, not a
  clinical or patient-record product. No HIPAA/BAA work is in scope.
- Terms of use plus a required acknowledgement at sign-up: the user won't upload identifiable patient
  information and uses the tool at their own risk. Acceptance and terms version are stored per user.
- Recommended before launch (owner action, not engineering): a short review of the terms by an attorney.

### Out of scope

Team / facility plans and seats, usage-based billing, native store apps (Apple/Google in-app billing
rules would apply to subscriptions sold inside them), HIPAA compliance, and any server-side document
storage. Documents still never leave the browser unless the user invokes an AI feature.

## Tiers

| | Anonymous | Free account (after trial) | Trial (7 days) and Pro |
|---|---|---|---|
| View, search within, read PDFs | ✅ | ✅ | ✅ |
| Edit, annotate, fill, sign, download edited | ❌ | ❌ | ✅ |
| AI requests (Summarize, Ask, Rewrite, Extract) | ❌ | 5 / day | 1,000 / month, max 100 / day |
| Voice minutes | ❌ | 5 / day | 120 / month, max 30 / day |
| Deep OCR pages | ❌ | ❌ | 300 / month |

- **Price:** Pro $29 / month or $249 / year (Stripe prices on one product, "PDF Studio Pro").
- **Trial:** owned by PDF Studio, not Stripe. Starts at account creation, 7 days, no card.
- Local tools that need no server (Tesseract OCR on scanned pages, on-device Search) stay available to
  anyone who can view.
- Allowance windows reset at UTC midnight (day) and on the user's billing anniversary (month; for
  trial and free users, the calendar month).

## Architecture

### Identity

- **Clerk** provides sign-in: Google and email magic link, with Clerk's components restyled to the
  Quiet Desk tokens. Clerk's publishable key is a build-time `VITE_CLERK_PUBLISHABLE_KEY` in
  `.env.production` (public); the secret key is a Worker secret.
- Three identities:
  - anonymous: today's daily IP-hash visitor id after Turnstile, unchanged;
  - account: Clerk user id `user_…`;
  - plan: derived from D1 (below).
- The AI Worker's `/session` accepts either a Turnstile token (anonymous) or a Clerk session JWT in
  `Authorization: Bearer`. It verifies the JWT against Clerk's JWKS (cached in memory with a TTL),
  loads the user row, and issues the existing HMAC session token with `{ sub, kind: "anon" | "user",
  plan, exp }`, where `plan` is one of `"anon"`, `"free"`, `"trial"` or `"pro"`. Session tokens last
  **10 minutes**, so plan changes take effect within minutes.

### Data (Cloudflare D1, new database `pdfstudio`)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- Clerk user id
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,       -- unix seconds
  trial_ends_at INTEGER NOT NULL,    -- created_at + 7 days
  terms_version TEXT,                -- null until accepted
  terms_accepted_at INTEGER,
  stripe_customer_id TEXT UNIQUE,
  subscription_status TEXT,          -- Stripe status or null
  current_period_end INTEGER,        -- unix seconds
  past_due_since INTEGER             -- set on first failed payment, cleared on success
);
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL); -- idempotency
```

Usage counters stay in **KV**, keyed by `sub` with day and month suffixes, following the existing
`quota.ts` / `voiceQuota.ts` patterns. Voice keeps its up-front 10-minute session reservation and
settlement.

### Entitlement rule (single function, unit-tested)

`plan(user, now)` returns:
- `"pro"` if `subscription_status` is `active` or `trialing`;
- `"pro"` if it is `canceled` and `now < current_period_end`;
- `"pro"` if it is `past_due` or `unpaid` and `now < past_due_since + 3 days`;
- otherwise `"trial"` if `now < trial_ends_at`;
- otherwise `"free"`.

`"trial"` and `"pro"` share limits and capabilities.

### Worker endpoints (AI Worker)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /session` | Turnstile or Clerk JWT | Issues the session token (extended as above). |
| `POST /me` | session | Returns plan, trial end, period end, today's and this month's usage and limits, and terms state. |
| `POST /terms/accept` | session (user) | Stores the current terms version and the time. |
| `POST /billing/checkout` | session (user) | Creates a Stripe Checkout Session for the monthly or yearly price, `client_reference_id` = user id, reusing or creating the customer. Returns the URL. |
| `POST /billing/portal` | session (user) | Creates a Customer Portal session. Returns the URL. |
| `POST /billing/webhook` | Stripe signature | Handles `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed` and `invoice.paid`, and updates the user row. Idempotent via `stripe_events`. |
| `POST /account/delete` | session (user) | Cancels the subscription, deletes the Clerk user and deletes the D1 row and KV counters. |

Existing `/ai`, `/ocr`, `/live` and `/live/usage` check `plan` and the per-plan limits:
- anonymous → 403 `account_required`;
- free → 403 `pro_required` for Deep OCR;
- over a limit → 429 with `{ error, resetAt, scope: "day" | "month" }`.

### App

- **Clerk** in `main.tsx`. A small `useAccount` store holds the plan state:
  - it is fetched from `/me` after sign-in and on focus;
  - the last good value is cached in localStorage for **7 days**, so an installed (offline) Pro user can
    keep editing;
  - each localStorage access is wrapped in try/catch.
- **Gates** (client-side, as agreed):
  - edit tools, annotation tools, sign, form fill and "Download" of an edited document are locked
    unless the plan is trial or pro;
  - locked controls show a lock badge and open the paywall sheet;
  - AI, Voice and Deep OCR follow the Worker's answers and also pre-check the plan, so locked
    states are shown up front.
- **Screens** (Quiet Desk; designed on the canvas before building):
  1. **Upgrade sheet** (anonymous): "Create a free account to edit and use AI — 7 days of full access,
     no card needed." Buttons: Create account, Sign in.
  2. **Clerk sign-in modal**, restyled.
  3. **Terms step** for new users and on a terms-version change: a summary and a required checkbox,
     "I understand PDF Studio is a general documentation tool, I won't upload identifiable patient
     information, and I use it at my own risk." It links to the full terms.
  4. **Trial pill** in the toolbar: "Trial · N days left". It opens the account menu.
  5. **Paywall sheet**: Pro features, a monthly/yearly toggle, $29 / $249, Subscribe (Stripe Checkout).
  6. **"Activating Pro…"** on return from Checkout: re-checks `/me` for up to about 30 seconds, then
     says "Payment received — Pro will appear shortly" and tells the user to refresh.
  7. **Account menu** (avatar; phone: in More): plan, trial or renewal date, today's and this month's
     usage bars, Manage billing (Portal), Delete account (confirm dialog), Sign out.
  8. **Limit panels**: the existing limit-reached panels add "Upgrade to Pro" (free) or the reset time
     (pro).

## Rollout

1. **Accounts phase:** ship everything behind `PAYWALL_ENABLED` (a Worker var and a build-time
   `VITE_PAYWALL_ENABLED`), **off**. Sign-in, terms, account menu and billing work; nothing is locked and
   anonymous limits are unchanged.
2. **Notice:** a dismissible banner for one week: "From [launch date, set at rollout], AI and editing need a free account."
3. **Paywall phase:** flip both flags on and deploy the Worker and the app.

## Error handling

- **Clerk unavailable:** sign-in shows an error; viewing still works; existing session tokens work until
  they expire.
- **Stripe webhook delayed or duplicated:** "Activating Pro…" re-checks; events are applied once.
- **JWT or JWKS failure:** 401, and the app asks the user to sign in again. The JWKS fetch failing falls
  back to the cached keys until their TTL.
- **D1 errors:** fail closed for paid features (503 `account_unavailable`), never open.
- **Offline:** AI and Voice show "You're offline". Editing honours the cached plan for up to 7 days.

## Security notes

- Worker secrets: `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus the existing
  ones.
- Stripe price ids live in Worker vars. The client never chooses a price amount.
- Webhook bodies are verified against the raw body and the signing secret before parsing.
- CORS stays restricted to the app origin. `/billing/webhook` is exempt from CORS and the session check,
  but requires the Stripe signature.
- The client-side editing gate can be bypassed with developer tools. That is accepted; every
  server-cost feature is enforced in the Worker.

## Testing

- **Worker unit tests:**
  - Clerk JWT verification with a local test key pair;
  - Stripe webhook signature checks (valid, tampered, stale timestamp) and idempotency;
  - the `plan()` table: trial, active, canceled before and after period end, past_due inside and
    outside the 3-day grace, free;
  - per-plan day and month limits for AI, Voice and OCR;
  - the endpoints' auth matrix.
- **App unit tests:** the `useAccount` cache (expiry, storage throwing); the gates per plan.
- **E2E:** a mocked `/session` and `/me` for anonymous, trial, free and pro, checking locked and
  unlocked tools, the upgrade and paywall sheets, and the terms step.
- **Manual before launch:** a full run in Clerk dev and Stripe test mode: sign up → terms → trial →
  checkout with a test card → Pro → Portal cancel → Pro until period end.

## Owner setup (not automatable here)

1. Create a Clerk application; enable Google and email magic link; add the app domain.
2. Create a Stripe account; create the product "PDF Studio Pro" with $29/month and $249/year prices;
   enable the Customer Portal; add the webhook endpoint and copy its signing secret.
3. Add the Worker secrets and vars (exact `wrangler` commands go in the implementation plan).
4. Provide or approve the terms of use text (Claude can draft it; legal review recommended).

## Delivery order (for the implementation plan)

1. D1 schema, `plan()`, the `/session` extension with Clerk JWT, `/me`, `/terms/accept`, all behind
   the flag.
2. Stripe: checkout, portal, webhook.
3. App: Clerk, `useAccount`, account menu, terms step, upgrade, paywall and activating screens (the
   canvas design comes first).
4. Gates and per-plan limits, still behind the flag.
5. Account deletion.
6. The rollout banner, the flag flip, and launch.
