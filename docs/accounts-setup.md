# Accounts and subscription: owner setup

This is the one-time setup for sign-in (Clerk), billing (Stripe) and the accounts database (Cloudflare D1), plus the rollout order.

> **D1 is already set up:** the `pdfstudio` database (`c8f49593-1c4f-438f-92c0-04dcdd1879fd`) was created on 2026-10-13, its id is in `worker/wrangler.jsonc`, and migration `0001_accounts.sql` has been applied remotely. Until you finish the rest of this setup, nothing here is live and `PAYWALL_ENABLED` stays `"false"`.

The terms page at `public/terms.html` is a draft. Fill in `[REFUND POLICY — owner to decide]` and `[CONTACT EMAIL — owner to fill in]` and get it legally reviewed before launch.

**Order matters: the Worker goes first.** Set up Clerk and Stripe (steps 1–2) to get their values, configure and deploy the Worker with the D1 id, `CLERK_ISSUER` and the secrets (steps 3–4), and only then ship the app with a Clerk publishable key (step 5). An app with a Clerk key talking to a Worker without `CLERK_ISSUER` cannot start a signed-in session: every signed-in request fails and users see "Please sign in again."

## 1. Clerk

1. Create an application and enable **Google** and **Email link** (email verification link) sign-in.
2. Add the allowed origin `https://pdfstudio.shemaiah7.workers.dev` (and your own domain if you add one).
3. Note three values for later: the **Frontend API URL** (this becomes `CLERK_ISSUER`; a trailing slash is fine), the **secret key** (`CLERK_SECRET_KEY`) and the **publishable key** (`VITE_CLERK_PUBLISHABLE_KEY`, used in step 5).

## 2. Stripe Dashboard

1. Create the product **PDF Studio Pro** with two recurring prices: **$29 per month** and **$249 per year**. Note their price ids for `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. Turn on the **Customer Portal** (Settings, Billing, Customer portal). Allow customers to cancel subscriptions, with cancellation at the **end of the billing period**.
3. Add a webhook endpoint `https://pdfstudio-ai.shemaiah7.workers.dev/billing/webhook` with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`

   Note its signing secret (`whsec_...`) for `STRIPE_WEBHOOK_SECRET`.
4. Decide your refund policy and write it into `public/terms.html`.

## 3. Cloudflare: database, vars and secrets

Run these in one terminal, one at a time. The first command changes into `worker/`; every later command in this step must run from that same terminal (or from `worker/`).

```bash
cd worker
```

The D1 database already exists and is migrated (see the note at the top). Only re-run this after adding a new migration:

```bash
npx wrangler d1 migrations apply pdfstudio --remote
```

```bash
npx wrangler secret put CLERK_SECRET_KEY
```

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Then fill in the Worker vars in `worker/wrangler.jsonc`: `CLERK_ISSUER`, `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`. Leave `PAYWALL_ENABLED` at `"false"`. With `PAYWALL_ENABLED="true"`, an empty `CLERK_ISSUER` means nobody can sign in and empty price ids make checkout fail, so set all three before launch.

### Where each value goes

| Value | Where | How |
| --- | --- | --- |
| `CLERK_ISSUER` | Worker var | `vars` in `worker/wrangler.jsonc` (your Clerk Frontend API URL, e.g. `https://xxxx.clerk.accounts.dev`; a live instance has its own URL) |
| `STRIPE_PRICE_MONTHLY` | Worker var | `vars` in `worker/wrangler.jsonc` (the `price_...` id of the $29/month price) |
| `STRIPE_PRICE_YEARLY` | Worker var | `vars` in `worker/wrangler.jsonc` (the `price_...` id of the $249/year price) |
| `PAYWALL_ENABLED` | Worker var | `vars` in `worker/wrangler.jsonc`, `"false"` until launch |
| `CLERK_SECRET_KEY` | Worker secret | `wrangler secret put` (above) |
| `STRIPE_SECRET_KEY` | Worker secret | `wrangler secret put` (above) |
| `STRIPE_WEBHOOK_SECRET` | Worker secret | `wrangler secret put` (above); the `whsec_...` signing secret of the webhook |
| `VITE_CLERK_PUBLISHABLE_KEY` | App build var | `.env.production` (a `pk_live_...` key; the build rejects `pk_test_`, and rejects an empty key when `VITE_PAYWALL_ENABLED=true`) |
| `VITE_PAYWALL_ENABLED` | App build var | `.env.production`, `false` until launch |
| `VITE_ROLLOUT_NOTICE` | App build var | `.env.production`, only during the notice period (the launch date only) |

Secrets never go in `wrangler.jsonc` or `.env.production`. Everything in `vars` and `.env.production` is public.

## 4. Deploy the Worker (before the app)

From the repository root:

```bash
npm --prefix worker run deploy
```

Check that `POST https://pdfstudio-ai.shemaiah7.workers.dev/me` with an anonymous session returns `{ "plan": "anon", "paywall": false }`.

## 5. Rollout sequence

1. **Accounts phase, flag off.** With the Worker from step 4 live, set `VITE_CLERK_PUBLISHABLE_KEY` in `.env.production`, keep `VITE_PAYWALL_ENABLED=false`, and deploy the app (`npm run deploy`, from a clean worktree of `origin/main`; merging does not deploy). People can sign in and accept the terms, but nothing is locked and everyone gets the current anonymous quotas. Check that sign-in works live and that a new account sees the terms step.
2. **Notice (7 days).** Set `VITE_ROLLOUT_NOTICE` to the launch date only, for example `VITE_ROLLOUT_NOTICE="November 3"`. The banner wraps it: "From November 3, AI and editing need a free account. Viewing stays free." Rebuild, deploy, and keep it up for 7 days.
3. **Launch.** Set the Worker var `PAYWALL_ENABLED="true"` and `VITE_PAYWALL_ENABLED=true` in `.env.production`, clear `VITE_ROLLOUT_NOTICE`, run all tests, deploy the Worker (`npm --prefix worker run deploy`), then the app (`npm run deploy`, from a clean worktree of `origin/main`).
4. **Trial clock, once, right after the flag flip.** Accounts created during the accounts and notice phases started their 7-day trial at sign-up, so most of it ran while nothing was gated. To give everyone at least 7 days of full access from launch, run this once from `worker/`, with `<LAUNCH_UNIX>` replaced by the launch time in Unix seconds (for example the output of `date +%s` at the flip):

   ```bash
   npx wrangler d1 execute pdfstudio --remote --command "UPDATE users SET trial_ends_at = MAX(trial_ends_at, <LAUNCH_UNIX>+604800)"
   ```

   It only extends trials: an account whose trial already ends later keeps it, and Pro subscribers are not affected. Do not run it again later.
5. **Verify live:**
   - anonymous: Voice shows "Create a free account to use this.";
   - a trial account can edit;
   - a free test account (trial ended) sees the paywall on Edit text.

## 6. Manual test-mode checklist

Use Clerk development and Stripe test keys, on a preview deploy or with `npm run worker:dev` plus `npm run dev`. Steps marked **(paywall on)** need `PAYWALL_ENABLED="true"` on the Worker and `VITE_PAYWALL_ENABLED=true` in the app (in dev, adding `?paywall` to the URL works instead of the app variable). The other steps work with the flag off.

- [ ] Sign up and accept the terms (flag off or on).
- [ ] **(paywall on)** The trial pill appears.
- [ ] **(paywall on)** Check out with card `4242 4242 4242 4242`; the app shows "Activating Pro…", then Pro.
- [ ] **(paywall on)** In the Customer Portal, cancel; the account menu says "Ends <date>" and the account stays Pro until the period ends.
- [ ] **(paywall on)** Run `stripe trigger invoice.payment_failed`; the account stays Pro (3-day grace).

Record the results in the pull request.

## Desktop app

Before turning on `PAYWALL_ENABLED`, design desktop sign-in: Google blocks OAuth inside embedded browsers and magic-link emails open in the system browser. Options: Clerk email-code sign-in inside the app, or a browser hand-off with a deep link.
