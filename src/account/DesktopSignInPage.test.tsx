// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
import DesktopSignInPage from "./DesktopSignInPage";

const S = "B".repeat(43);
const h = vi.hoisted(() => ({
  loaded: true, signedIn: true,
  getToken: vi.fn(), signOut: vi.fn(), signInProps: {} as Record<string, unknown>,
}));
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ isLoaded: h.loaded, isSignedIn: h.signedIn, getToken: h.getToken }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "me@example.com" } } }),
  useClerk: () => ({ signOut: h.signOut }),
  SignIn: (props: Record<string, unknown>) => { h.signInProps = props; return <div>mock-signin</div>; },
}));

const navigate = vi.fn();
const fetchSpy = vi.fn();
beforeEach(() => {
  h.loaded = true; h.signedIn = true;
  h.getToken.mockReset().mockResolvedValue("jwt1");
  h.signOut.mockReset().mockResolvedValue(undefined);
  navigate.mockClear(); fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  window.history.replaceState({}, "", `/desktop-signin?state=${S}`);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const reply = (status: number, body: unknown) => fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const mount = () => render(<DesktopSignInPage navigate={navigate} />);

it("shows only the invalid message for a bad state and never fetches", () => {
  window.history.replaceState({}, "", "/desktop-signin?state=short");
  mount();
  expect(screen.getByText("This sign-in link isn't valid. Start again from the SentinelPDF app.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("renders Clerk's sign-in when signed out", () => {
  h.signedIn = false;
  mount();
  expect(screen.getByText("mock-signin")).toBeTruthy();
});

it("keeps ?state through both sign-in and first-time sign-up redirects", () => {
  h.signedIn = false;
  mount();
  expect(h.signInProps.withSignUp).toBe(true);
  expect(h.signInProps.forceRedirectUrl).toBe(window.location.href);
  expect(h.signInProps.signUpForceRedirectUrl).toBe(window.location.href);
});

it("renders nothing but the header while Clerk loads", () => {
  h.loaded = false;
  mount();
  expect(screen.queryByText("mock-signin")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
});

it("confirms the account when signed in", () => {
  mount();
  expect(screen.getByText(/Sign in to the SentinelPDF app as/)).toBeTruthy();
  expect(screen.getByText("me@example.com")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not you? Switch account" })).toBeTruthy();
});

it("Continue fetches a ticket with the JWT, opens the app link and offers a re-open button", async () => {
  reply(200, { ticket: "tkt" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("You're signed in. Return to SentinelPDF.");
  const link = `sentinelpdf://signin?ticket=tkt&state=${S}`;
  expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer jwt1" }) }));
  expect(navigate).toHaveBeenCalledWith(link);
  navigate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Return to SentinelPDF" }));
  expect(navigate).toHaveBeenCalledWith(link);
});

it("429 says to wait", async () => {
  reply(429, { error: "rate_limited" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Too many tries. Wait a minute and try again.");
  expect(navigate).not.toHaveBeenCalled();
});

it("other errors say sign-in is unavailable", async () => {
  reply(502, { error: "upstream" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Sign-in isn't available right now. You can keep viewing PDFs.");
});

it("Switch account signs out and returns to the sign-in view", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Not you? Switch account" }));
  await waitFor(() => expect(h.signOut).toHaveBeenCalled());
  expect(h.signOut).toHaveBeenCalledWith({ redirectUrl: window.location.href });
});
