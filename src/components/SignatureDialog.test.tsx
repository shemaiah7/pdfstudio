// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import SignatureDialog from "./SignatureDialog";

const PNG = "data:image/png;base64,AA==";
beforeEach(() => {
  localStorage.clear();
  const ctx = { fillText: vi.fn(), measureText: () => ({ width: 40 }), clearRect: vi.fn(), fillRect: vi.fn(), font: "", fillStyle: "", textBaseline: "" };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SignatureDialog", () => {
  it("uses the saved signature", () => {
    localStorage.setItem("pdfstudio.signature", PNG);
    const onConfirm = vi.fn();
    render(<SignatureDialog onConfirm={onConfirm} onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("sig-use-saved"));
    expect(onConfirm).toHaveBeenCalledWith(PNG);
  });
  it("forgets the saved signature", () => {
    localStorage.setItem("pdfstudio.signature", PNG);
    render(<SignatureDialog onConfirm={() => undefined} onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("sig-forget"));
    expect(localStorage.getItem("pdfstudio.signature")).toBeNull();
    expect(screen.queryByTestId("sig-use-saved")).toBeNull();
  });
  it("types a name and confirms a PNG", async () => {
    const onConfirm = vi.fn();
    render(<SignatureDialog onConfirm={onConfirm} onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("sig-tab-type"));
    fireEvent.change(screen.getByTestId("sig-name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByTestId("sig-confirm"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toMatch(/^data:image\/png/);
  });
  it("rejects a 3 MB upload", async () => {
    render(<SignatureDialog onConfirm={() => undefined} onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("sig-tab-upload"));
    const file = new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" });
    fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [file] } });
    expect(await screen.findByTestId("sig-error")).toBeTruthy();
  });
});
