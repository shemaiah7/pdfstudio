import { create } from "zustand";

export type PanelStep = "email" | "waiting" | "code" | "unavailable";
interface DesktopSignInState { open: boolean; step: PanelStep; error: string | null; openPanel(): void; close(): void; setStep(s: PanelStep): void; setError(e: string | null): void }

export const useDesktopSignIn = create<DesktopSignInState>((set) => ({
  open: false, step: "email", error: null,
  openPanel: () => set({ open: true, step: "email", error: null }),
  close: () => set({ open: false, error: null }),
  setStep: (step) => set({ step, error: null }),
  setError: (error) => set({ error }),
}));
