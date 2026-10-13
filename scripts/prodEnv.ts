// A production build without these ships with AI, Search and Voice silently disabled ("AI features are not configured"); fail instead.
const REQUIRED_PROD_ENV = ['VITE_AI_URL', 'VITE_TURNSTILE_SITE_KEY'] as const

/** Names of env vars that are missing or hold dev-only values. VITE_CLERK_PUBLISHABLE_KEY is optional (no key = no sign-in) unless VITE_PAYWALL_ENABLED is true, and a test key must never ship. */
export function checkProdEnv(env: Record<string, string>): string[] {
  const bad: string[] = REQUIRED_PROD_ENV.filter((k) => !env[k] || /localhost|127\.0\.0\.1|^1x0000/.test(env[k]))
  const clerk = env.VITE_CLERK_PUBLISHABLE_KEY ?? ''
  // A test key must never ship; and with the paywall on, a missing key means nobody can sign in to use or buy anything.
  if (/^pk_test_/.test(clerk) || (env.VITE_PAYWALL_ENABLED === 'true' && !clerk)) bad.push('VITE_CLERK_PUBLISHABLE_KEY')
  return bad
}
