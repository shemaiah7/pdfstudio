// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DropZone from "./DropZone";

const clerkOn = vi.hoisted(() => ({ value: false }));
vi.mock("../account/clerk", () => ({ clerkEnabled: () => clerkOn.value }));
vi.mock("./account/AccountEntry", () => ({ default: () => <div data-testid="account-entry-stub" /> }));

describe("DropZone", () => {
  afterEach(() => { cleanup(); clerkOn.value = false; });
  it("shows the voice hint on the empty state", () => {
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.getByTestId("voice-hint").textContent).toMatch(/talk to it/);
  });
  it("offers sign-in on the start screen when accounts are on (so signing out never strands the user)", () => {
    clerkOn.value = true;
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.getByTestId("account-entry-stub")).toBeTruthy();
  });
  it("links privacy, terms and the desktop app in the start-screen footer (Google branding needs the privacy link)", () => {
    render(<DropZone onFiles={vi.fn()} empty />);
    const hrefs = Array.from(document.querySelectorAll("footer a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/privacy", "/terms", "/download"]);
  });
  it("shows no account control when accounts are off", () => {
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.queryByTestId("account-entry-stub")).toBeNull();
  });
});
