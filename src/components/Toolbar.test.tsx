// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Toolbar from "./Toolbar";
import { useDocumentStore } from "../store/document";
import { loadFixture } from "../test/loadFixture";
import { useAccount } from "../account/store";
import { useSheets } from "./account/useGate";

beforeEach(async () => {
  useDocumentStore.getState().reset();
  await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); useAccount.setState({ me: null, loading: false }); useSheets.setState({ open: null }); });

describe("Toolbar phone controls", () => {
  it("More actions toggles aria-expanded and the .tb-actions.open panel, and closes on Escape", () => {
    const { container } = render(<Toolbar scale={1} setScale={() => {}} onFiles={() => {}} onTogglePages={() => {}} pagesOpen={false} />);
    const more = screen.getByLabelText("More actions");
    const actions = container.querySelector(".tb-actions")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(actions.classList.contains("open")).toBe(false);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(actions.classList.contains("open")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(actions.classList.contains("open")).toBe(false);
  });

  it("Pages button reports its state and calls onTogglePages", () => {
    const toggle = vi.fn();
    render(<Toolbar scale={1} setScale={() => {}} onFiles={() => {}} onTogglePages={toggle} pagesOpen />);
    const pages = screen.getByLabelText("Pages");
    expect(pages.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(pages);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe("Toolbar plan gates", () => {
  const renderBar = () => render(<Toolbar scale={1} setScale={() => {}} onFiles={() => {}} onTogglePages={() => {}} pagesOpen={false} />);
  it("free plan: rotate and delete open the paywall and leave the document unchanged", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    useDocumentStore.setState({ selection: new Set([useDocumentStore.getState().pages[0].id]) });
    renderBar();
    const rotate = screen.getByTestId("rotate-right") as HTMLButtonElement;
    expect(rotate.className).toContain("locked");
    expect(rotate.disabled).toBe(false);
    fireEvent.click(rotate);
    expect(useSheets.getState().open).toBe("paywall");
    expect(useDocumentStore.getState().pages[0].rotation).toBe(0);
    useSheets.setState({ open: null });
    fireEvent.click(screen.getByTestId("delete"));
    expect(useSheets.getState().open).toBe("paywall");
    expect(useDocumentStore.getState().pages).toHaveLength(3);
  });
  it("trial plan: rotate works", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "trial", paywall: true } as never });
    useDocumentStore.setState({ selection: new Set([useDocumentStore.getState().pages[0].id]) });
    renderBar();
    fireEvent.click(screen.getByTestId("rotate-right"));
    expect(useSheets.getState().open).toBeNull();
    expect(useDocumentStore.getState().pages[0].rotation).toBe(90);
  });
  it("paywall off: rotate works with no locked class", () => {
    useDocumentStore.setState({ selection: new Set([useDocumentStore.getState().pages[0].id]) });
    renderBar();
    expect(screen.getByTestId("rotate-right").className).not.toContain("locked");
    fireEvent.click(screen.getByTestId("rotate-right"));
    expect(useDocumentStore.getState().pages[0].rotation).toBe(90);
  });
  it("free plan: Download is locked only when there are unsaved edits", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    renderBar();
    expect(screen.getByTestId("download").className).not.toContain("locked");
    useDocumentStore.getState().rotate([useDocumentStore.getState().pages[0].id], 90);
    cleanup();
    renderBar();
    expect(useDocumentStore.getState().isDirty()).toBe(true);
    expect(screen.getByTestId("download").className).toContain("locked");
    fireEvent.click(screen.getByTestId("download"));
    expect(useSheets.getState().open).toBe("paywall");
  });
});
