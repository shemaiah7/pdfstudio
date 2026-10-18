// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DropZone from "./DropZone";

const clerkOn = vi.hoisted(() => ({ value: false }));
vi.mock("../account/clerk", () => ({ clerkEnabled: () => clerkOn.value }));
const paywallOn = vi.hoisted(() => ({ value: false }));
vi.mock("../account/capabilities", () => ({ paywallEnabled: () => paywallOn.value }));
vi.mock("./account/AccountEntry", () => ({ default: () => <div data-testid="account-entry-stub" /> }));

describe("DropZone", () => {
  afterEach(() => { cleanup(); clerkOn.value = false; paywallOn.value = false; });
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
  it("states the plan allowance that matches the paywall setting", () => {
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.getByText("Free: 20 AI requests and 30 minutes of voice a day")).toBeTruthy();
    cleanup();
    paywallOn.value = true;
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.getByText("Free account: 7 days of everything, then 5 AI questions and 5 Voice minutes a day · Pro $29/mo")).toBeTruthy();
  });
  it("shows no account control when accounts are off", () => {
    render(<DropZone onFiles={vi.fn()} empty />);
    expect(screen.queryByTestId("account-entry-stub")).toBeNull();
  });
});
