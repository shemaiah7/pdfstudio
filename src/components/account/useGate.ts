import { useCallback } from "react";
import { create } from "zustand";
import { can, paywallEnabled, type Feature } from "../../account/capabilities";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";

/** Owner session per the last /session (AI client) or /me response. */
const isOwner = (aiOwner: boolean, me: { owner?: boolean } | null): boolean => aiOwner || me?.owner === true;

export type SheetName = "upgrade" | "paywall";
interface SheetsState { open: SheetName | null; show(sheet: SheetName): void; close(): void }

export const useSheets = create<SheetsState>((set) => ({
  open: null,
  show: (sheet) => set({ open: sheet }),
  close: () => set({ open: null }),
}));

/** Non-hook gate for event handlers outside components: true when allowed; otherwise opens the right sheet (anon: upgrade, free: paywall) and returns false. */
export function requireFeature(feature: Feature): boolean {
  const { me, loading } = useAccount.getState();
  if (isOwner(useAiStore.getState().owner, me)) return true;
  // A signed-in user whose plan is still loading must not be shown the anonymous Upgrade sheet.
  if (me === null && loading && paywallEnabled()) return false;
  const plan = useAccount.getState().plan();
  if (can(plan, feature, paywallEnabled())) return true;
  useSheets.getState().show(plan === "anon" ? "upgrade" : "paywall");
  return false;
}

/** `require(feature)` is true when the plan allows it; otherwise it opens the right sheet and returns false. */
export function useGate(): { require(feature: Feature): boolean } {
  const require = useCallback((feature: Feature): boolean => requireFeature(feature), []);
  return { require };
}

/** True when the feature is locked for the current plan (paywall on and plan too low); drives the `locked` class. */
export function useLocked(feature: Feature): boolean {
  const plan = useAccount((s) => s.plan());
  const owner = isOwner(useAiStore((s) => s.owner), useAccount((s) => s.me));
  return !can(plan, feature, paywallEnabled(), owner);
}
