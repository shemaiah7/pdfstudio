import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const KEY = "pdfstudio.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const ORDER: ThemePreference[] = ["system", "light", "dark"];

export const resolveTheme = (pref: ThemePreference, osDark: boolean): ResolvedTheme =>
  pref === "system" ? (osDark ? "dark" : "light") : pref;

const osMedia = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;

const readPreference = (): ThemePreference => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
};

const writePreference = (p: ThemePreference) => {
  try { window.localStorage.setItem(KEY, p); } catch { /* storage unavailable (private mode etc.) */ }
};

const apply = (resolved: ResolvedTheme) => { document.documentElement.dataset.theme = resolved; };

interface ThemeState { preference: ThemePreference; resolved: ResolvedTheme; setPreference(p: ThemePreference): void; cycle(): void }

export const useThemeStore = create<ThemeState>((set, get) => {
  const mq = osMedia();
  const preference = readPreference();
  const resolved = resolveTheme(preference, mq?.matches ?? false);
  apply(resolved);
  mq?.addEventListener("change", (e) => {
    if (get().preference !== "system") return;
    const next = resolveTheme("system", e.matches);
    apply(next);
    set({ resolved: next });
  });
  return {
    preference,
    resolved,
    setPreference: (p) => {
      writePreference(p);
      const next = resolveTheme(p, osMedia()?.matches ?? false);
      apply(next);
      set({ preference: p, resolved: next });
    },
    cycle: () => get().setPreference(ORDER[(ORDER.indexOf(get().preference) + 1) % ORDER.length]),
  };
});
