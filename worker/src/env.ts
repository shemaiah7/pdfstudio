export interface Env {
  QUOTA: KVNamespace;
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_HOSTNAMES: string; // comma-separated
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_AGENT_ID: string;
  VOICE_DAILY_SECONDS?: string; // default "1800"
  DB: D1Database;
  PAYWALL_ENABLED?: string;       // "true" turns on gates and per-plan limits
  CLERK_ISSUER: string;           // e.g. https://<instance>.clerk.accounts.dev
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_MONTHLY: string;
  STRIPE_PRICE_YEARLY: string;
  APP_URL: string;
  OWNER_KEY?: string; // secret; >= 32 chars unlocks unlimited owner sessions
}
