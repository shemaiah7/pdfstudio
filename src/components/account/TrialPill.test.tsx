// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach } from "vitest";
import TrialPill from "./TrialPill";
import { useAccount } from "../../account/store";

afterEach(() => { cleanup(); useAccount.setState({ me: null }); });

it("shows days left during the trial and opens the menu on click", () => {
  const onClick = vi.fn();
  useAccount.setState({ me: { plan: "trial", paywall: true, trialEndsAt: Date.now() / 1000 + 5.5 * 86400 } as never });
  render(<TrialPill onClick={onClick} />);
  fireEvent.click(screen.getByRole("button", { name: "Trial · 6 days left" }));
  expect(onClick).toHaveBeenCalled();
});
it.each([["pro", true], ["trial", false], ["free", true]] as const)("hidden for %s (paywall %s)", (plan, paywall) => {
  useAccount.setState({ me: { plan, paywall, trialEndsAt: Date.now() / 1000 + 86400 } as never });
  const { container } = render(<TrialPill onClick={vi.fn()} />);
  expect(container.innerHTML).toBe("");
});
