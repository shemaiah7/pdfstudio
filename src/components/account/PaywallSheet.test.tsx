// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
import PaywallSheet from "./PaywallSheet";
import { useSheets } from "./useGate";
import { useAiStore } from "../../store/ai";

beforeEach(() => { useSheets.setState({ open: "paywall" }); });
afterEach(() => { cleanup(); useSheets.setState({ open: null }); });

it("renders nothing unless the paywall is open", () => {
  useSheets.setState({ open: null });
  const { container } = render(<PaywallSheet />);
  expect(container.innerHTML).toBe("");
});

it("defaults to yearly and subscribes with checkout('year')", async () => {
  const checkout = vi.fn().mockResolvedValue("https://stripe.test/c"), navigate = vi.fn();
  useAiStore.setState({ client: { checkout } as never });
  render(<PaywallSheet navigate={navigate} />);
  expect(screen.getByRole("radio", { name: /Yearly/ }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("$249")).toBeTruthy();
  expect(screen.getByText("2 months free")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("https://stripe.test/c"));
  expect(checkout).toHaveBeenCalledWith("year");
});

it("monthly toggle subscribes with checkout('month')", async () => {
  const checkout = vi.fn().mockResolvedValue("https://stripe.test/m");
  useAiStore.setState({ client: { checkout } as never });
  render(<PaywallSheet navigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
  expect(screen.getByText("$29")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  await vi.waitFor(() => expect(checkout).toHaveBeenCalledWith("month"));
});

it("shows an error when checkout fails", async () => {
  useAiStore.setState({ client: { checkout: vi.fn().mockRejectedValue(new Error("x")) } as never });
  const navigate = vi.fn();
  render(<PaywallSheet navigate={navigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  expect(await screen.findByText("Couldn't start checkout. Try again.")).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});
