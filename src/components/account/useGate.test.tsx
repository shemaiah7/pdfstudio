// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
import { useGate, useLocked, useSheets } from "./useGate";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";
vi.mock("../../account/capabilities", async (orig) => ({ ...(await orig<typeof import("../../account/capabilities")>()), paywallEnabled: () => true }));

beforeEach(() => { useSheets.setState({ open: null }); useAccount.setState({ loading: false }); useAiStore.setState({ owner: false }); });

it.each([["anon", "upgrade"], ["free", "paywall"]] as const)("%s editing opens %s", (plan, sheet) => {
  useAccount.setState({ me: plan === "anon" ? null : ({ plan, paywall: true } as never) });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("edit")).toBe(false);
  expect(useSheets.getState().open).toBe(sheet);
});
it("trial edits freely", () => {
  useAccount.setState({ me: { plan: "trial", paywall: true } as never });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("edit")).toBe(true);
  expect(useSheets.getState().open).toBeNull();
});

it("signed in but /me still loading: returns false, opens no sheet, does not refresh again", () => {
  const refresh = vi.fn(async () => {});
  useAccount.setState({ me: null, loading: true, refresh });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("edit")).toBe(false);
  expect(useSheets.getState().open).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});
it("signed out (me null, not loading): shows the Upgrade sheet", () => {
  useAccount.setState({ me: null, loading: false });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("edit")).toBe(false);
  expect(useSheets.getState().open).toBe("upgrade");
});

it("owner session (from /session) passes every gate with the paywall on, even anonymous or while /me loads", () => {
  useAiStore.setState({ owner: true });
  for (const loading of [false, true]) {
    useAccount.setState({ me: null, loading });
    const { result } = renderHook(() => useGate());
    for (const f of ["edit", "ai", "voice", "deepOcr"] as const) expect(result.current.require(f)).toBe(true);
  }
  expect(useSheets.getState().open).toBeNull();
  const { result } = renderHook(() => useLocked("deepOcr"));
  expect(result.current).toBe(false);
});
it("owner reported by /me passes the gate on a free plan", () => {
  useAccount.setState({ me: { plan: "free", paywall: true, owner: true } as never });
  const { result } = renderHook(() => useGate());
  expect(result.current.require("deepOcr")).toBe(true);
  expect(useSheets.getState().open).toBeNull();
});
