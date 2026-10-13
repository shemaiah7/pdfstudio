import { useCallback } from "react";
import { create } from "zustand";
import { can, paywallEnabled, type Feature } from "../../account/capabilities";
import { useAccount } from "../../account/store";

export type SheetName = "upgrade" | "paywall";
interface SheetsState { open: SheetName | null; show(sheet: SheetName): void; close(): void }

export const useSheets = create<SheetsState>((set) => ({
  open: null,
  show: (sheet) => set({ open: sheet }),
  close: () => set({ open: null }),
}));

/** `require(feature)` is true when the plan allows it; otherwise it opens the right sheet (anon: upgrade, free: paywall) and returns false. */
export function useGate(): { require(feature: Feature): boolean } {
  const require = useCallback((feature: Feature): boolean => {
    const { me, loading } = useAccount.getState();
    // A signed-in user whose plan is still loading must not be shown the anonymous Upgrade sheet.
    if (me === null && loading && paywallEnabled()) return false;
    const plan = useAccount.getState().plan();
    if (can(plan, feature, paywallEnabled())) return true;
    useSheets.getState().show(plan === "anon" ? "upgrade" : "paywall");
    return false;
  }, []);
  return { require };
}

/** True when the feature is locked for the current plan (paywall on and plan too low); drives the `locked` class. */
export function useLocked(feature: Feature): boolean {
  const plan = useAccount((s) => s.plan());
  return !can(plan, feature, paywallEnabled());
}
