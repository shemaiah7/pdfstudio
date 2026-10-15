// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { desktopBridge, isDesktop, subscribeDesktopFiles, type DesktopFile } from "./bridge";

type W = Window & { sentinelDesktop?: unknown };
afterEach(() => { delete (window as W).sentinelDesktop; });

describe("desktop bridge", () => {
  it("is absent in a normal browser", () => {
    expect(desktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
    const off = subscribeDesktopFiles(vi.fn());
    expect(() => off()).not.toThrow();
  });

  it("turns opened files into File objects and unsubscribes", async () => {
    let handler: ((f: DesktopFile) => void) | null = null;
    const unsub = vi.fn();
    (window as W).sentinelDesktop = { version: "1.0.0", onOpenFile: (cb: (f: DesktopFile) => void) => { handler = cb; return unsub; } };
    expect(isDesktop()).toBe(true);
    const got = vi.fn();
    const off = subscribeDesktopFiles(got);
    handler!({ name: "_REPORT.PDF", bytes: new Uint8Array([37, 80, 68, 70]) });
    const files = got.mock.calls[0][0] as File[];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("_REPORT.PDF");
    expect(files[0].type).toBe("application/pdf");
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    off();
    expect(unsub).toHaveBeenCalled();
  });
});
