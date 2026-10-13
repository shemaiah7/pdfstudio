export type Plan = "anon" | "free" | "trial" | "pro";
export type Feature = "edit" | "ai" | "voice" | "deepOcr";
export const paywallEnabled = (): boolean => import.meta.env.VITE_PAYWALL_ENABLED === "true";
export function can(plan: Plan, feature: Feature, paywall: boolean = paywallEnabled()): boolean {
  if (!paywall) return true;
  if (feature === "edit" || feature === "deepOcr") return plan === "trial" || plan === "pro";
  return plan !== "anon";
}
