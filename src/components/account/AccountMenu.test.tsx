// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach } from "vitest";
import AccountMenu from "./AccountMenu";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({ user: { fullName: "Jordan Avery", primaryEmailAddress: { emailAddress: "jordan@clinic.org" } } }),
  useClerk: () => ({ signOut }),
}));

const pro = {
  plan: "pro", paywall: true, status: "active", periodEnd: Date.UTC(2027, 9, 12) / 1000,
  usage: { aiDay: 3, aiMonth: 312, voiceDaySec: 600, voiceMonthSec: 2880, ocrDay: 0, ocrMonth: 22 },
  limits: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
};
afterEach(() => { cleanup(); useAccount.setState({ me: null }); signOut.mockClear(); });

it("shows the user, plan and usage numbers", () => {
  useAccount.setState({ me: pro as never });
  render(<AccountMenu onClose={vi.fn()} />);
  expect(screen.getByText("jordan@clinic.org")).toBeTruthy();
  expect(screen.getByText(/^Pro$/)).toBeTruthy();
  expect(screen.getByText("312 / 1,000")).toBeTruthy();
  expect(screen.getByText("48 / 120")).toBeTruthy();
  expect(screen.getByText("22 / 300")).toBeTruthy();
});

it("Manage billing opens the portal", async () => {
  const portal = vi.fn().mockResolvedValue("https://stripe.test/portal"), navigate = vi.fn();
  useAiStore.setState({ client: { portal } as never });
  useAccount.setState({ me: pro as never });
  render(<AccountMenu onClose={vi.fn()} navigate={navigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("https://stripe.test/portal"));
});

it("Delete my account stays disabled until DELETE is typed, then deletes and signs out", async () => {
  const deleteAccount = vi.fn().mockResolvedValue(undefined);
  useAiStore.setState({ client: { deleteAccount } as never });
  useAccount.setState({ me: pro as never });
  render(<AccountMenu onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Delete account/ }));
  const btn = screen.getByRole("button", { name: "Delete my account" }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Type DELETE/), { target: { value: "delete" } });
  expect(btn.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Type DELETE/), { target: { value: "DELETE" } });
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  await vi.waitFor(() => expect(deleteAccount).toHaveBeenCalled());
  await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
});

it("Sign out calls Clerk signOut", () => {
  useAccount.setState({ me: pro as never });
  render(<AccountMenu onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalled();
});
