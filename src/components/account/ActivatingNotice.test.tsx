// @vitest-environment jsdom
import { render, screen, cleanup, act } from "@testing-library/react";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
import ActivatingNotice from "./ActivatingNotice";
import { useAccount } from "../../account/store";

const setUrl = (qs: string) => window.history.replaceState(null, "", `/${qs}`);
let refresh: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  refresh = vi.fn().mockResolvedValue(undefined);
  useAccount.setState({ me: { plan: "free", paywall: true } as never, refresh } as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); setUrl(""); });

it("polls every 3s up to 10 times, then shows the fallback and clears the param", async () => {
  setUrl("?checkout=success");
  render(<ActivatingNotice />);
  expect(screen.getByText("Activating Pro…")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(refresh).toHaveBeenCalledTimes(10);
  expect(screen.getByText("Payment received — Pro will appear shortly. Refresh in a minute.")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(refresh).toHaveBeenCalledTimes(10);
  expect(window.location.search).toBe("");
});

it("stops when the plan becomes pro, toasts, and removes the param", async () => {
  setUrl("?checkout=success&x=1");
  refresh.mockImplementation(async () => { if (refresh.mock.calls.length === 2) useAccount.setState({ me: { plan: "pro", paywall: true } as never }); });
  render(<ActivatingNotice />);
  await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Pro is active")).toBeTruthy();
  expect(window.location.search).toBe("?x=1");
});

it("cancel just removes the parameter", () => {
  setUrl("?checkout=cancel");
  const { container } = render(<ActivatingNotice />);
  expect(container.innerHTML).toBe("");
  expect(window.location.search).toBe("");
  expect(refresh).not.toHaveBeenCalled();
});
