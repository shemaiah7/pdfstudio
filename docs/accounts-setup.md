# Accounts and subscription: owner setup

This is the one-time setup for sign-in (Clerk), billing (Stripe) and the accounts database (Cloudflare D1), plus the rollout order.

> **Do not merge or deploy the `feat/accounts` branch until the D1 `database_id` placeholder in `worker/wrangler.jsonc` (`REPLACE_WITH_ID_FROM_wrangler_d1_create`) has been replaced with the real id from step 1 below.** Deploying the Worker with the placeholder fails. Until you finish this setup, nothing here is live and `PAYWALL_ENABLED` stays `"false"`.

The terms page at `public/terms.html` is a draft. Fill in `[REFUND POLICY — owner to decide]` and `[CONTACT EMAIL — owner to fill in]` and get it legally reviewed before launch.

## 1. Cloudflare: database and secrets

Run these from the repository root, one at a time.

```bash
cd worker
```

```bash
npx wrangler d1 create pdfstudio
```

Paste the printed `database_id` into `worker/wrangler.jsonc` (`d1_databases[0].database_id`).

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

## 2. Where each value goes

| Value | Where | How |
| --- | --- | --- |
| `CLERK_ISSUER` | Worker var | `vars` in `worker/wrangler.jsonc` (your Clerk Frontend API URL, e.g. `https://xxxx.clerk.accounts.dev`; a live instance has its own URL) |
| `STRIPE_PRICE_MONTHLY` | Worker var | `vars` in `worker/wrangler.jsonc` (the `price_...` id of the $29/month price) |
| `STRIPE_PRICE_YEARLY` | Worker var | `vars` in `worker/wrangler.jsonc` (the `price_...` id of the $249/year price) |
| `PAYWALL_ENABLED` | Worker var | `vars` in `worker/wrangler.jsonc`, `"false"` until launch |
| `CLERK_SECRET_KEY` | Worker secret | `wrangler secret put` (step 1) |
| `STRIPE_SECRET_KEY` | Worker secret | `wrangler secret put` (step 1) |
| `STRIPE_WEBHOOK_SECRET` | Worker secret | `wrangler secret put` (step 1); the `whsec_...` signing secret of the webhook below |
| `VITE_CLERK_PUBLISHABLE_KEY` | App build var | `.env.production` (a `pk_live_...` key; the build rejects `pk_test_`) |
| `VITE_PAYWALL_ENABLED` | App build var | `.env.production`, `false` until launch |
| `VITE_ROLLOUT_NOTICE` | App build var | `.env.production`, only during the notice period |

Secrets never go in `wrangler.jsonc` or `.env.production`. Everything in `vars` and `.env.production` is public.

## 3. Stripe Dashboard

1. Create the product **PDF Studio Pro** with two recurring prices: **$29 per month** and **$249 per year**. Copy their price ids into `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. Turn on the **Customer Portal** (Settings, Billing, Customer portal). Allow customers to cancel subscriptions, with cancellation at the **end of the billing period**.
3. Add a webhook endpoint `https://pdfstudio-ai.shemaiah7.workers.dev/billing/webhook` with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`

   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Decide your refund policy and write it into `public/terms.html`.

## 4. Clerk

1. Create an application and enable **Google** and **Email link** (email verification link) sign-in.
2. Add the allowed origin `https://pdfstudio.shemaiah7.workers.dev` (and your own domain if you add one).
3. Copy the publishable key into `VITE_CLERK_PUBLISHABLE_KEY` and the secret key into the `CLERK_SECRET_KEY` secret. Set `CLERK_ISSUER` to the instance's Frontend API URL.

## 5. Rollout sequence

1. **Accounts phase, flag off.** Deploy the Worker and the app with `PAYWALL_ENABLED="false"` and `VITE_PAYWALL_ENABLED=false`. People can sign in, but nothing is locked and everyone gets the current anonymous quotas. Check that `/me` returns `{ "plan": "anon", "paywall": false }` for an anonymous session and that sign-in works live.
2. **Notice (7 days).** Rebuild with `VITE_ROLLOUT_NOTICE="From <date>, AI and editing need a free account."` and deploy. Keep it up for 7 days.
3. **Launch.** Set the Worker var `PAYWALL_ENABLED="true"` and `VITE_PAYWALL_ENABLED=true` in `.env.production`, clear `VITE_ROLLOUT_NOTICE`, run all tests, deploy the Worker (`npm --prefix worker run deploy`), then the app (`npm run deploy`, from a clean worktree of `origin/main`; merging does not deploy). Verify live:
   - anonymous: Voice shows "Create a free account to use this.";
   - a trial account can edit;
   - a free test account (trial ended) sees the paywall on Edit text.

## 6. Manual test-mode checklist

Use Clerk development and Stripe test keys, on a preview deploy or with `npm run worker:dev` plus `npm run dev`.

- [ ] Sign up, accept the terms, and the trial pill appears.
- [ ] Check out with card `4242 4242 4242 4242`; the app shows "Activating Pro…", then Pro.
- [ ] In the Customer Portal, cancel; the account stays Pro until the period ends.
- [ ] Run `stripe trigger invoice.payment_failed`; the account stays Pro (3-day grace).

Record the results in the pull request.
