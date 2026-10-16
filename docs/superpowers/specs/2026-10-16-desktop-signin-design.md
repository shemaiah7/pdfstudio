# Desktop sign-in — design

Date: 2026-10-16. Status: approved in conversation (sections 1–2); awaiting written-spec review.
Builds on: `2026-10-12-subscription-funnel-design.md` (Clerk accounts) and `2026-10-15-sentinelpdf-desktop-design.md` (Electron shell, `sentinelpdf://` links).

## Problem

On the web, sign-in is Clerk's modal with Google and an email magic link. Inside the desktop app neither works: Google refuses OAuth in embedded browser windows, and a magic link opens in the system browser, signing the browser in rather than the app.

## Decision (from the user)

Two ways to sign in inside the desktop app:
- **Primary: "Sign in with your browser"** — browser hand-off with a one-time Clerk sign-in token (the Slack / Zoom / Notion pattern).
- **Fallback: "Use an email code instead"** — a 6-digit email code entered inside the app (Clerk `email_code` strategy), no browser involved.

The website keeps Clerk's modal unchanged. The desktop panel replaces it only when `window.sentinelDesktop` exists.

## Flow A — Sign in with your browser

1. The web app (inside the desktop window) calls `window.sentinelDesktop.startBrowserSignIn()`.
2. Desktop main creates `state` = 32 random bytes, base64url (43 chars). It stores `{ state, expiresAt: now + 10 min }` in memory (one pending sign-in at a time; a new start replaces the old one). It opens `<APP_URL>/desktop-signin?state=<state>` with `shell.openExternal`.
3. `/desktop-signin` (web page, browser):
   - Rejects a `state` that isn't 43 base64url characters. It shows "This sign-in link isn't valid. Start again from the SentinelPDF app." and does nothing else.
   - If the browser isn't signed in to Clerk, it shows Clerk's normal sign-in (Google and magic link) on the page.
   - Once signed in, it shows "Sign in to the SentinelPDF app as **<email>**", with a primary button **Continue** and a link **Not you? Switch account**, which signs out of Clerk in the browser and shows sign-in again.
   - On Continue, it calls `POST /desktop/ticket` on the AI worker with the browser's Clerk session token. It receives `{ ticket }` and navigates to `sentinelpdf://signin?ticket=<ticket>&state=<state>`.
   - It then shows "You're signed in. Return to SentinelPDF." with a **Return to SentinelPDF** button that re-opens the same link, in case the browser asked first or the user dismissed the prompt.
4. Desktop main receives the link (macOS `open-url`; Windows argv / `second-instance`). It parses it with `signInLinkFrom(url)` → `{ ticket, state } | null`.
   - If the pending state matches exactly and hasn't expired, it clears the pending state (single use), focuses or restores the window, and sends the ticket to the page over IPC `sentinel:signin-ticket`.
   - Otherwise it ignores the link and sends `sentinel:signin-failed` with reason `"expired"`, so the panel shows "That sign-in link expired. Try again."
5. The page receives the ticket through `window.sentinelDesktop.onSignInTicket(cb)`. It calls Clerk `signIn.create({ strategy: "ticket", ticket })`, then `setActive({ session: createdSessionId })`. Existing ClerkBridge logic takes over (`/me`, terms acknowledgement, plan). No reload.

Transport notes:
- The ticket rides in the query of the `sentinelpdf:` URL, never the `#` fragment, because browsers strip fragments from app links (observed with owner links on 2026-10-15). This is acceptable: the ticket is single-use, expires in 300 s, and the app only accepts it with a matching state.
- Neither the ticket nor the state is ever logged by the page, main or the worker.

## Flow B — Email code inside the app

A custom two-step form in the desktop sign-in panel, using Clerk's JS API (not the prebuilt component, which would show Google and magic link):
1. **Email:** `signIn.create({ identifier: email })`.
   - If Clerk says the account doesn't exist (`form_identifier_not_found`), switch to sign-up: `signUp.create({ emailAddress })` and `signUp.prepareEmailAddressVerification({ strategy: "email_code" })`.
   - Otherwise `signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId })` with the email factor's id from `supportedFirstFactors`.
2. **Code:** six-digit input, then `signIn.attemptFirstFactor({ strategy: "email_code", code })`, or for sign-up `signUp.attemptEmailAddressVerification({ code })`. Then `setActive({ session })`.
3. Controls: **Resend code** (re-prepare; disabled for 30 s after sending), **Use a different email** (back to step 1). Clerk errors are shown inline in plain words, e.g. "That code isn't right. Check the email or resend."

## Desktop sign-in panel (web app, desktop only)

Opened wherever the app would open Clerk's sign-in modal (`AccountEntry`, `UpgradeSheet`, `PaywallSheet` sign-in paths) when `isDesktop()` is true. It uses the existing `Sheet` component and Quiet Desk styles.

States:
- **Choose:** title "Sign in to SentinelPDF"; primary "Sign in with your browser"; link "Use an email code instead"; small note "Google and email links open in your browser."
- **Waiting:** "Finish signing in in your browser…", with **Cancel** (back to Choose) and "Use an email code instead". There's no timeout UI beyond the 10-minute state expiry; a late ticket after Cancel is still accepted if the state is valid, since the user did finish.
- **Email** and **Code:** as in Flow B.
- **Error:** inline message with the relevant retry.
- **Unavailable:** if Clerk fails to load, "Sign-in isn't available right now. You can keep viewing PDFs."

When accounts are off (no Clerk key), no Sign in entry renders, as today.

## Worker — `POST /desktop/ticket`

- Auth: `Authorization: Bearer <Clerk session JWT>`, verified with the existing `worker/src/clerk.ts` (issuer, JWKS, `azp` against ALLOWED_ORIGIN). Missing or invalid → 401.
- Calls Clerk Backend API `POST https://api.clerk.com/v1/sign_in_tokens` with `Authorization: Bearer ${CLERK_SECRET_KEY}` and body `{ "user_id": <JWT sub>, "expires_in_seconds": 300 }`. It returns `{ ticket: <token> }` with `cache-control: no-store`.
- Rate limit: 5 per minute per user id (KV `QUOTA`, key `dt:<uid>:<minute>`). Over the limit → 429 `{ error: "rate_limited" }`.
- Clerk not configured (`CLERK_SECRET_KEY` or `CLERK_ISSUER` empty) → 503 `{ error: "accounts_unavailable" }`. Clerk API error → 502 `{ error: "upstream" }`, with no Clerk body echoed.
- Never logs the ticket. CORS as other endpoints.

## Desktop app (release 1.0.4)

- `desktop/src/signin.ts` (pure, tested):
  - `createPendingSignIn(now, randomBytes)` → `{ state, expiresAt }`;
  - `signInLinkFrom(url)` → `{ ticket, state } | null`. Scheme `sentinelpdf:`, host `signin`, path `""` or `"/"`, exactly the params `ticket` and `state`. The ticket is 1–4096 URL-safe characters; the state matches `^[A-Za-z0-9_-]{43}$`.
  - `consumeSignIn(pending, link, now)` → `"ok" | "mismatch" | "expired"`.
- `desktop/src/main.ts`:
  - IPC `sentinel:start-browser-signin` (sender must be the app window) creates the pending sign-in and opens the browser at `<url>/desktop-signin?state=…` (`url` is the same app URL constant main already uses).
  - The link handlers route `signin` links alongside `owner` links.
  - Results go to the window over `sentinel:signin-ticket` / `sentinel:signin-failed`.
- `desktop/src/preload.ts` exposes:
  - `startBrowserSignIn(): void`
  - `onSignInTicket(cb: (ticket: string) => void): () => void`
  - `onSignInFailed(cb: (reason: "expired") => void): () => void`
- `src/desktop/bridge.ts`: add the optional `startBrowserSignIn`, `onSignInTicket` and `onSignInFailed` to `DesktopBridge`. An older desktop version without them falls back to showing only the email-code option.

## Owner setup (added to docs/accounts-setup.md)

In the Clerk dashboard, under User & authentication → Email, enable **Email verification code** for sign-in and sign-up, alongside the magic link and Google. No new secrets: `CLERK_SECRET_KEY` (already required for accounts) is used for sign-in tokens.

## Error handling summary

| Situation | What the user sees |
|---|---|
| Browser never returns | Waiting state with Cancel and the email-code option |
| Ticket expired or already used (Clerk rejects) | "Sign-in didn't finish. Try again." |
| Link with unknown or expired state | "That sign-in link expired. Try again." |
| Wrong email code | Inline message plus Resend |
| `/desktop/ticket` 429 | "Too many tries. Wait a minute and try again." |
| Clerk unavailable | "Sign-in isn't available right now. You can keep viewing PDFs." |
| Invalid state on `/desktop-signin` | "This sign-in link isn't valid. Start again from the SentinelPDF app." |

## Testing

- **Desktop unit tests:**
  - `signInLinkFrom`: valid; wrong host; missing ticket; missing state; extra params; bad state format; ticket in the fragment rather than the query; oversize ticket.
  - `createPendingSignIn` and `consumeSignIn`: ok, mismatch, expired, single use.
- **Worker tests** (Clerk Backend API faked through the `fetch` mock pattern the worker tests already use): 401 without or with an invalid JWT; ticket issued for the JWT's `sub` only; 300 s expiry in the request body; 429 on the 6th call in a minute; 503 when unconfigured; 502 on a Clerk error with no body leak.
- **Web unit tests:**
  - desktop panel states and transitions, with Clerk's `signIn`/`signUp` mocked;
  - the bridge ticket handler calls `signIn.create({ strategy: "ticket" })` then `setActive`;
  - `/desktop-signin` rejects a bad state, shows the account confirmation, and builds the exact `sentinelpdf://signin?ticket=…&state=…` URL;
  - outside the desktop app, sign-in still uses Clerk's modal.
- **Desktop smoke test (Playwright Electron):** start a browser sign-in with `shell.openExternal` stubbed in test mode via an env flag honored only when `!app.isPackaged`, then feed `sentinelpdf://signin?ticket=t&state=<captured>`. The page receives `t`; a second feed with the same state is rejected.
- **Manual, after Clerk is set up:** one real sign-in each way on Mac.

## Out of scope

Phone apps, Windows code signing, turning accounts on (still behind `PAYWALL_ENABLED`), and any change to web sign-in.
