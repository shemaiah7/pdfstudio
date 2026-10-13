// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach } from "vitest";
import UpgradeSheet from "./UpgradeSheet";
import { useSheets } from "./useGate";

vi.mock("../../account/clerk", () => ({ clerkEnabled: () => true }));
vi.mock("@clerk/clerk-react", () => ({
  SignInButton: ({ children }: { children: React.ReactElement }) => children,
  SignUpButton: ({ children }: { children: React.ReactElement }) => children,
}));
afterEach(() => { cleanup(); useSheets.setState({ open: null }); });

it("shows the anonymous upgrade copy with both buttons and closes", () => {
  useSheets.setState({ open: "upgrade" });
  render(<UpgradeSheet />);
  expect(screen.getByText("Create a free account to edit and use AI")).toBeTruthy();
  expect(screen.getByText(/7 days of full access, no card needed/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Sign in/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(useSheets.getState().open).toBeNull();
});
