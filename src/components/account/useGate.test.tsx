// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
import { useGate, useSheets } from "./useGate";
import { useAccount } from "../../account/store";
vi.mock("../../account/capabilities", async (orig) => ({ ...(await orig<typeof import("../../account/capabilities")>()), paywallEnabled: () => true }));

beforeEach(() => { useSheets.setState({ open: null }); useAccount.setState({ loading: false }); });

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
