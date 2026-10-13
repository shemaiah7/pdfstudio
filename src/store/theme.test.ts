// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveTheme, useThemeStore } from "./theme";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useThemeStore.setState({ preference: "system", resolved: "light" });
  delete document.documentElement.dataset.theme;
});

describe("resolveTheme", () => {
  it.each([
    ["system", false, "light"], ["system", true, "dark"],
    ["light", false, "light"], ["light", true, "light"],
    ["dark", false, "dark"], ["dark", true, "dark"],
  ] as const)("%s with osDark=%s -> %s", (pref, osDark, out) => {
    expect(resolveTheme(pref, osDark)).toBe(out);
  });
});

describe("theme store", () => {
  it("cycles system -> light -> dark -> system", () => {
    const seen = [useThemeStore.getState().preference];
    for (let i = 0; i < 3; i++) { useThemeStore.getState().cycle(); seen.push(useThemeStore.getState().preference); }
    expect(seen).toEqual(["system", "light", "dark", "system"]);
  });

  it("setPreference writes storage and <html data-theme>", () => {
    useThemeStore.getState().setPreference("dark");
    expect(localStorage.getItem("pdfstudio.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
    useThemeStore.getState().setPreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("does not throw when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => useThemeStore.getState().setPreference("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(useThemeStore.getState().preference).toBe("dark");
  });
});
