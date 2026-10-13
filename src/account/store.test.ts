// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAccount, CACHE_KEY, CACHE_MAX_AGE_MS } from "./store";
import { useAiStore } from "../store/ai";
import { setSignedIn } from "./authState";

const me = (plan: "pro" | "free") => ({ plan, paywall: true });
beforeEach(() => { localStorage.clear(); setSignedIn(false); useAccount.setState({ me: null, loading: false, error: null }); });

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
    useAiStore.setState({ client: { me: vi.fn().mockResolvedValue(me("free")), resetSession: vi.fn() } as never });
    await useAccount.getState().refresh();
    expect(useAccount.getState().plan()).toBe("free");
  });
  it("storage throwing never crashes", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => useAccount.getState().setFromCache()).not.toThrow();
    spy.mockRestore();
  });
  it("a plan change resets the AI session so gated calls carry the new plan", async () => {
    const resetSession = vi.fn();
    const meFn = vi.fn().mockResolvedValueOnce(me("free")).mockResolvedValueOnce(me("free")).mockResolvedValueOnce(me("pro"));
    useAiStore.setState({ client: { me: meFn, resetSession } as never });
    await useAccount.getState().refresh(); // first load: nothing to compare with
    await useAccount.getState().refresh(); // unchanged
    expect(resetSession).not.toHaveBeenCalled();
    await useAccount.getState().refresh(); // free -> pro
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().plan()).toBe("pro");
  });
  it("signed in but /me says anon: resets the session and retries once", async () => {
    setSignedIn(true);
    const resetSession = vi.fn();
    const meFn = vi.fn().mockResolvedValueOnce({ plan: "anon", paywall: true }).mockResolvedValueOnce(me("pro"));
    useAiStore.setState({ client: { me: meFn, resetSession } as never });
    await useAccount.getState().refresh();
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(meFn).toHaveBeenCalledTimes(2);
    expect(useAccount.getState().plan()).toBe("pro");
  });
  it("signed in and still anon after the retry: keeps the cached plan and cache", async () => {
    setSignedIn(true);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), me: me("pro") }));
    useAccount.getState().setFromCache();
    useAiStore.setState({ client: { me: vi.fn().mockResolvedValue({ plan: "anon", paywall: true }), resetSession: vi.fn() } as never });
    await useAccount.getState().refresh();
    expect(useAccount.getState().plan()).toBe("pro");
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).me.plan).toBe("pro");
  });
});
