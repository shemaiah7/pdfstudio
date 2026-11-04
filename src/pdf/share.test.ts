// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sharePdf } from "./share";

vi.mock("./download", () => ({ saveBlob: vi.fn() }));
import { saveBlob } from "./download";

const bytes = new Uint8Array([1, 2, 3]);
const err = (name: string) => Object.assign(new Error(name), { name });
const setNav = (share?: unknown, canShare?: unknown) => {
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
};
afterEach(() => { setNav(undefined, undefined); delete (window as unknown as { sentinelDesktop?: unknown }).sentinelDesktop; vi.mocked(saveBlob).mockClear(); });
beforeEach(() => setNav(undefined, undefined));

describe("sharePdf", () => {
  it("shares one PDF File through navigator.share", async () => {
    const share = vi.fn(async () => {});
    setNav(share, () => true);
    expect(await sharePdf(bytes, "a-edited.pdf")).toBe("shared");
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe("a-edited.pdf");
    expect(arg.files[0].type).toBe("application/pdf");
    expect(saveBlob).not.toHaveBeenCalled();
  });
  it("AbortError is silent", async () => {
    setNav(vi.fn(async () => { throw err("AbortError"); }), () => true);
    expect(await sharePdf(bytes, "a.pdf")).toBe("cancelled");
  });
  it("NotAllowedError returns a retry that reuses the built file", async () => {
    const share = vi.fn().mockRejectedValueOnce(err("NotAllowedError")).mockResolvedValueOnce(undefined);
    setNav(share, () => true);
    const r = await sharePdf(bytes, "a.pdf");
    expect(typeof r).toBe("object");
    if (typeof r !== "object") return;
    expect(await r.retry()).toBe("shared");
    expect(share).toHaveBeenCalledTimes(2);
    expect((share.mock.calls[1] as unknown[])[0]).toEqual((share.mock.calls[0] as unknown[])[0]);
    expect(((share.mock.calls[1] as unknown as [{ files: File[] }])[0]).files[0].name).toBe("a.pdf");
  });
  it("other errors propagate", async () => {
    setNav(vi.fn(async () => { throw err("DataError"); }), () => true);
    await expect(sharePdf(bytes, "a.pdf")).rejects.toThrow();
  });
  it("uses the desktop bridge when present", async () => {
    const share = vi.fn(async () => "shown" as const);
    (window as unknown as { sentinelDesktop: unknown }).sentinelDesktop = { version: "1", onOpenFile: () => () => {}, share };
    expect(await sharePdf(bytes, "a.pdf")).toBe("shared");
    expect(share).toHaveBeenCalledWith("a.pdf", bytes);
    expect(saveBlob).not.toHaveBeenCalled();
  });
  it("desktop bridge reporting unsupported falls back to saving", async () => {
    (window as unknown as { sentinelDesktop: unknown }).sentinelDesktop = { version: "1", onOpenFile: () => () => {}, share: async () => "unsupported" };
    expect(await sharePdf(bytes, "a.pdf")).toBe("saved");
    expect(saveBlob).toHaveBeenCalledWith(bytes, "a.pdf");
  });
  it("saves a download when sharing files is unsupported", async () => {
    setNav(vi.fn(), () => false);
    expect(await sharePdf(bytes, "a.pdf")).toBe("saved");
    expect(saveBlob).toHaveBeenCalledWith(bytes, "a.pdf");
  });
});
