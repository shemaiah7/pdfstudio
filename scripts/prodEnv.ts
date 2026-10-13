// A production build without these ships with AI, Search and Voice silently disabled ("AI features are not configured"); fail instead.
const REQUIRED_PROD_ENV = ['VITE_AI_URL', 'VITE_TURNSTILE_SITE_KEY'] as const

/** Names of env vars that are missing or hold dev-only values. VITE_CLERK_PUBLISHABLE_KEY is optional (no key = no sign-in), but a test key must never ship. */
export function checkProdEnv(env: Record<string, string>): string[] {
  const bad: string[] = REQUIRED_PROD_ENV.filter((k) => !env[k] || /localhost|127\.0\.0\.1|^1x0000/.test(env[k]))
  if (/^pk_test_/.test(env.VITE_CLERK_PUBLISHABLE_KEY ?? '')) bad.push('VITE_CLERK_PUBLISHABLE_KEY')
  return bad
}
