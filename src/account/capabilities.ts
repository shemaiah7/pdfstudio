export type Plan = "anon" | "free" | "trial" | "pro";
export type Feature = "edit" | "ai" | "voice" | "deepOcr";
/** Dev servers can also turn the paywall on with `?paywall` (for e2e); production builds ignore the parameter. */
export const paywallEnabled = (): boolean => {
  if (import.meta.env.VITE_PAYWALL_ENABLED === "true") return true;
  if (!import.meta.env.DEV) return false;
  try { return new URLSearchParams(window.location.search).has("paywall"); } catch { return false; }
};
export function can(plan: Plan, feature: Feature, paywall: boolean = paywallEnabled()): boolean {
  if (!paywall) return true;
  if (feature === "edit" || feature === "deepOcr") return plan === "trial" || plan === "pro";
  return plan !== "anon";
}
