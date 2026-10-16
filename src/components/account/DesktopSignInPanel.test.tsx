// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
import DesktopSignInPanel, { DesktopTicketListener } from "./DesktopSignInPanel";
import { useDesktopSignIn } from "../../account/desktopSignIn";

const h = vi.hoisted(() => ({ signIn: {} as Record<string, unknown>, signUp: {} as Record<string, unknown>, setActive: undefined as unknown, loaded: true, signedIn: false }));
vi.mock("@clerk/clerk-react", () => ({
  useSignIn: () => ({ isLoaded: h.loaded, signIn: h.signIn, setActive: h.setActive }),
  useSignUp: () => ({ isLoaded: h.loaded, signUp: h.signUp, setActive: h.setActive }),
  useAuth: () => ({ isSignedIn: h.signedIn }),
  SignInButton: ({ children }: { children: unknown }) => children,
  SignUpButton: ({ children }: { children: unknown }) => children,
}));

type Bridge = Record<string, unknown>;
let ticketCb: (t: string) => void = () => {};
let failedCb: (r: "expired") => void = () => {};
const startBrowserSignIn = vi.fn();
function setBridge(extra: Bridge = { startBrowserSignIn }) {
  (window as unknown as { sentinelDesktop: Bridge }).sentinelDesktop = {
    version: "1", onOpenFile: () => () => {},
    onSignInTicket: (cb: (t: string) => void) => { ticketCb = cb; return () => {}; },
    onSignInFailed: (cb: (r: "expired") => void) => { failedCb = cb; return () => {}; },
    ...extra,
  };
}
const reset = () => useDesktopSignIn.setState({ open: false, step: "choose", error: null });

beforeEach(() => {
  h.loaded = true; h.signedIn = false;
  h.setActive = vi.fn().mockResolvedValue(undefined);
  h.signIn = { create: vi.fn(), prepareFirstFactor: vi.fn().mockResolvedValue({}), attemptFirstFactor: vi.fn() };
  h.signUp = { create: vi.fn().mockResolvedValue({}), prepareEmailAddressVerification: vi.fn().mockResolvedValue({}), attemptEmailAddressVerification: vi.fn() };
  startBrowserSignIn.mockClear();
  setBridge(); reset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete (window as unknown as { sentinelDesktop?: unknown }).sentinelDesktop; reset(); });

const mount = () => render(<><DesktopTicketListener /><DesktopSignInPanel /></>);
const open = () => act(() => useDesktopSignIn.getState().openPanel());
const signIn = () => h.signIn as { create: ReturnType<typeof vi.fn>; prepareFirstFactor: ReturnType<typeof vi.fn>; attemptFirstFactor: ReturnType<typeof vi.fn> };
const signUp = () => h.signUp as { create: ReturnType<typeof vi.fn>; prepareEmailAddressVerification: ReturnType<typeof vi.fn>; attemptEmailAddressVerification: ReturnType<typeof vi.fn> };

async function toCode(email = "me@example.com") {
  mount(); open();
  fireEvent.click(screen.getByRole("button", { name: "Use an email code instead" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: email } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await screen.findByLabelText(/code/i);
}
const submitCode = (code: string) => {
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: code } });
  fireEvent.submit(screen.getByLabelText(/code/i).closest("form")!);
};

it("1 choose -> browser -> waiting -> cancel", () => {
  mount(); open();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with your browser" }));
  expect(startBrowserSignIn).toHaveBeenCalled();
  expect(screen.getByText("Finish signing in in your browser…")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Sign in with your browser" })).toBeTruthy();
});

it("2 handles a ticket with the panel closed, then closes the panel", async () => {
  const log = ["log", "warn", "error"].map((k) => vi.spyOn(console, k as "log").mockImplementation(() => {}));
  signIn().create.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
  mount(); open();
  expect(screen.getByText("Sign in to SentinelPDF")).toBeTruthy();
  act(() => ticketCb("tkt"));
  await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ session: "sess_1" }));
  expect(signIn().create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "tkt" });
  await waitFor(() => expect(useDesktopSignIn.getState().open).toBe(false));
  await waitFor(() => expect(screen.queryByText("Sign in to SentinelPDF")).toBeNull());
  log.forEach((s) => s.mock.calls.forEach((c) => expect(JSON.stringify(c)).not.toContain("tkt")));
});

it("3 waits for Clerk to load before using the ticket", async () => {
  h.loaded = false;
  signIn().create.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
  const { rerender } = mount();
  act(() => ticketCb("tkt"));
  expect(signIn().create).not.toHaveBeenCalled();
  h.loaded = true;
  rerender(<><DesktopTicketListener /><DesktopSignInPanel /></>);
  await waitFor(() => expect(signIn().create).toHaveBeenCalledTimes(1));
  expect(signIn().create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "tkt" });
});

it("4 shows an error when Clerk rejects the ticket", async () => {
  signIn().create.mockRejectedValue(new Error("bad"));
  mount();
  act(() => ticketCb("tkt"));
  expect(await screen.findByText("Sign-in didn't finish. Try again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in with your browser" })).toBeTruthy();
});

it("5 expired: error when signed out, none when signed in", () => {
  mount();
  act(() => failedCb("expired"));
  expect(screen.getByText("That sign-in link expired. Try again.")).toBeTruthy();
  cleanup(); reset(); h.signedIn = true;
  mount();
  act(() => failedCb("expired"));
  expect(screen.queryByText("That sign-in link expired. Try again.")).toBeNull();
});

it("6 email code for an existing account", async () => {
  const log = ["log", "warn", "error"].map((k) => vi.spyOn(console, k as "log").mockImplementation(() => {}));
  signIn().create.mockResolvedValue({ supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }] });
  signIn().attemptFirstFactor.mockResolvedValue({ status: "complete", createdSessionId: "sess_2" });
  await toCode("  Me@Example.COM ");
  expect(signIn().create).toHaveBeenCalledWith({ identifier: "me@example.com" });
  expect(signIn().prepareFirstFactor).toHaveBeenCalledWith({ strategy: "email_code", emailAddressId: "idn_1" });
  submitCode("123456");
  await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ session: "sess_2" }));
  expect(signIn().attemptFirstFactor).toHaveBeenCalledWith({ strategy: "email_code", code: "123456" });
  log.forEach((s) => s.mock.calls.forEach((c) => expect(JSON.stringify(c)).not.toContain("tkt")));
});

it("7 email code for a new account", async () => {
  signIn().create.mockRejectedValue({ errors: [{ code: "form_identifier_not_found" }] });
  signUp().attemptEmailAddressVerification.mockResolvedValue({ status: "complete", createdSessionId: "sess_3" });
  await toCode("new@x.y");
  expect(signUp().create).toHaveBeenCalledWith({ emailAddress: "new@x.y" });
  expect(signUp().prepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: "email_code" });
  submitCode("654321");
  await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ session: "sess_3" }));
  expect(signUp().attemptEmailAddressVerification).toHaveBeenCalledWith({ code: "654321" });
});

it("8 wrong code shows the retry message", async () => {
  signIn().create.mockResolvedValue({ supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }] });
  signIn().attemptFirstFactor.mockRejectedValue({ errors: [{ code: "form_code_incorrect" }] });
  await toCode();
  submitCode("000000");
  expect(await screen.findByText("That code isn't right. Check the email or resend.")).toBeTruthy();
});

it("9 resend is disabled for 30 s; different email returns to the email step", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  signIn().create.mockResolvedValue({ supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }] });
  await toCode();
  const resend = screen.getByRole("button", { name: "Resend code" }) as HTMLButtonElement;
  expect(resend.disabled).toBe(true);
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(resend.disabled).toBe(false);
  fireEvent.click(resend);
  await waitFor(() => expect(signIn().prepareFirstFactor).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
  expect(screen.getByRole("textbox")).toBeTruthy();
});

it("10 older desktop app without startBrowserSignIn opens on the email step", () => {
  delete (window as unknown as { sentinelDesktop?: unknown }).sentinelDesktop;
  (window as unknown as { sentinelDesktop: Bridge }).sentinelDesktop = { version: "1", onOpenFile: () => () => {} };
  mount(); open();
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in with your browser" })).toBeNull();
});

it("11 renders nothing outside the desktop app", () => {
  delete (window as unknown as { sentinelDesktop?: unknown }).sentinelDesktop;
  const { container } = mount(); open();
  expect(container.innerHTML).toBe("");
});

it("12 a non-'not found' sign-in error does not start a sign-up and is shown", async () => {
  signIn().create.mockRejectedValue({ errors: [{ code: "too_many_requests", longMessage: "Slow down." }] });
  mount(); open();
  fireEvent.click(screen.getByRole("button", { name: "Use an email code instead" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "a@b.c" } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(await screen.findByText("Slow down.")).toBeTruthy();
  expect(signUp().create).not.toHaveBeenCalled();
});

it("13 a sign-up that needs more details says so, not 'wrong code'", async () => {
  signIn().create.mockRejectedValue({ errors: [{ code: "form_identifier_not_found" }] });
  signUp().attemptEmailAddressVerification.mockResolvedValue({ status: "missing_requirements" });
  await toCode("new@x.y");
  submitCode("654321");
  expect(await screen.findByText("Your account needs more details. Sign in with your browser instead.")).toBeTruthy();
  expect(screen.queryByText("That code isn't right. Check the email or resend.")).toBeNull();
  expect(h.setActive).not.toHaveBeenCalled();
});

it("14 other thrown errors in the code step say sign-in didn't finish", async () => {
  signIn().create.mockResolvedValue({ supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }] });
  signIn().attemptFirstFactor.mockRejectedValue(new Error("network"));
  await toCode();
  submitCode("111111");
  expect(await screen.findByText("Sign-in didn't finish. Try again.")).toBeTruthy();
});

it("15 a late browser ticket is dropped silently once signed in", async () => {
  h.signedIn = true;
  mount();
  act(() => ticketCb("tkt"));
  await act(async () => { await Promise.resolve(); });
  expect(signIn().create).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(useDesktopSignIn.getState().error).toBeNull();
});
