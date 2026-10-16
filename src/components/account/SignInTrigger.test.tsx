// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach } from "vitest";
import SignInTrigger from "./SignInTrigger";
import { useDesktopSignIn } from "../../account/desktopSignIn";

vi.mock("@clerk/clerk-react", () => ({
  SignInButton: ({ children }: { children: React.ReactElement }) => <div data-testid="clerk-in">{children}</div>,
  SignUpButton: ({ children }: { children: React.ReactElement }) => <div data-testid="clerk-up">{children}</div>,
}));
afterEach(() => { cleanup(); delete (window as unknown as { sentinelDesktop?: unknown }).sentinelDesktop; useDesktopSignIn.setState({ open: false, step: "choose", error: null }); });

it("renders Clerk's buttons outside the desktop app", () => {
  render(<><SignInTrigger mode="sign-in"><button>in</button></SignInTrigger><SignInTrigger mode="sign-up"><button>up</button></SignInTrigger></>);
  expect(screen.getByTestId("clerk-in").textContent).toBe("in");
  expect(screen.getByTestId("clerk-up").textContent).toBe("up");
});

it("opens the desktop panel and calls onBeforeOpen inside the desktop app", () => {
  (window as unknown as { sentinelDesktop: unknown }).sentinelDesktop = { version: "1", onOpenFile: () => () => {} };
  const before = vi.fn();
  render(<SignInTrigger mode="sign-in" onBeforeOpen={before}><button>go</button></SignInTrigger>);
  expect(screen.queryByTestId("clerk-in")).toBeNull();
  fireEvent.click(screen.getByText("go"));
  expect(before).toHaveBeenCalled();
  expect(useDesktopSignIn.getState().open).toBe(true);
});
