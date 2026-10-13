// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAccount, CACHE_KEY, CACHE_MAX_AGE_MS } from "./store";
import { useAiStore } from "../store/ai";

const me = (plan: "pro" | "free") => ({ plan, paywall: true });
beforeEach(() => { localStorage.clear(); useAccount.setState({ me: null, loading: false, error: null }); });

describe("useAccount", () => {
  it("refresh stores me and caches it", async () => {
    useAiStore.setState({ client: { me: vi.fn().mockResolvedValue(me("pro")) } as never });
    await useAccount.getState().refresh();
    expect(useAccount.getState().plan()).toBe("pro");
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).me.plan).toBe("pro");
  });
  it("cache honoured under 7 days, ignored after", () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now() - CACHE_MAX_AGE_MS + 1000, me: me("pro") }));
    useAccount.getState().setFromCache();
    expect(useAccount.getState().plan()).toBe("pro");
    useAccount.setState({ me: null });
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now() - CACHE_MAX_AGE_MS - 1, me: me("pro") }));
    useAccount.getState().setFromCache();
    expect(useAccount.getState().plan()).toBe("anon");
  });
  it("fresh refresh wins over cache", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), me: me("pro") }));
    useAccount.getState().setFromCache();
    useAiStore.setState({ client: { me: vi.fn().mockResolvedValue(me("free")) } as never });
    await useAccount.getState().refresh();
    expect(useAccount.getState().plan()).toBe("free");
  });
  it("storage throwing never crashes", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => useAccount.getState().setFromCache()).not.toThrow();
    spy.mockRestore();
  });
});
