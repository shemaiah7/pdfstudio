// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ClerkBridge } from "./ClerkBridge";
import { useAccount, CACHE_KEY } from "./store";
import { useAiStore } from "../store/ai";

const auth = vi.hoisted(() => ({ isSignedIn: undefined as boolean | undefined, getToken: async () => null as string | null }));
vi.mock("@clerk/clerk-react", () => ({ useAuth: () => auth }));

const me = (plan: "pro" | "free") => ({ plan, paywall: true });
const cached = JSON.stringify({ at: Date.now(), me: me("pro") });

beforeEach(() => {
  localStorage.clear();
  auth.isSignedIn = undefined;
  useAiStore.setState({ client: null });
  useAccount.setState({ me: null, loading: false, error: null });
});
afterEach(() => { cleanup(); });

describe("ClerkBridge", () => {
  it("refreshes exactly once when a client becomes available while signed in", async () => {
    auth.isSignedIn = true;
    const meFn = vi.fn().mockResolvedValue(me("pro"));
    render(<ClerkBridge />);
    expect(meFn).not.toHaveBeenCalled();
    await act(async () => {
      useAiStore.setState({ client: { me: meFn, resetSession: vi.fn() } as never });
    });
    expect(meFn).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().plan()).toBe("pro");
  });

  it("first render signed out does not clear the cache", () => {
    auth.isSignedIn = false;
    localStorage.setItem(CACHE_KEY, cached);
    render(<ClerkBridge />);
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });

  it("true to false transition clears the cache", () => {
    auth.isSignedIn = true;
    localStorage.setItem(CACHE_KEY, cached);
    const { rerender } = render(<ClerkBridge />);
    auth.isSignedIn = false;
    rerender(<ClerkBridge />);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(useAccount.getState().me).toBeNull();
  });
});
