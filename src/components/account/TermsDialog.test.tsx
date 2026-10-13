// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach } from "vitest";
import TermsDialog from "./TermsDialog";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";
import { TERMS_CHECKBOX, TERMS_VERSION } from "../../account/terms";

afterEach(() => { cleanup(); useAccount.setState({ me: null }); });

it("blocks Continue until the box is ticked, then accepts the current version", async () => {
  const acceptTerms = vi.fn().mockResolvedValue(undefined), me = vi.fn().mockResolvedValue({ plan: "trial", paywall: true, termsAccepted: true });
  useAiStore.setState({ client: { acceptTerms, me } as never });
  useAccount.setState({ me: { plan: "trial", paywall: true, termsAccepted: false } as never });
  render(<TermsDialog signedIn />);
  const btn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(TERMS_CHECKBOX));
  fireEvent.click(btn);
  await vi.waitFor(() => expect(acceptTerms).toHaveBeenCalledWith(TERMS_VERSION));
  await vi.waitFor(() => expect(me).toHaveBeenCalled());
});

it.each([
  ["signed out", false, { plan: "trial", paywall: true, termsAccepted: false }],
  ["accepted", true, { plan: "trial", paywall: true, termsAccepted: true }],
  ["paywall off", true, { plan: "trial", paywall: false, termsAccepted: false }],
  ["no account yet", true, null],
] as const)("renders nothing when %s", (_n, signedIn, me) => {
  useAccount.setState({ me: me as never });
  const { container } = render(<TermsDialog signedIn={signedIn} />);
  expect(container.innerHTML).toBe("");
});

it("cannot be dismissed with Escape", () => {
  useAccount.setState({ me: { plan: "trial", paywall: true, termsAccepted: false } as never });
  render(<TermsDialog signedIn />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("moves focus into the dialog and wraps Tab within it", () => {
  useAccount.setState({ me: { plan: "trial", paywall: true, termsAccepted: false } as never });
  render(<TermsDialog signedIn />);
  const dialog = screen.getByRole("dialog");
  expect(dialog.contains(document.activeElement)).toBe(true);
  const box = screen.getByLabelText(TERMS_CHECKBOX);
  fireEvent.click(box);
  const btn = screen.getByRole("button", { name: "Continue" });
  btn.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(dialog.querySelector("a"));
});
