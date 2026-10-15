// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { desktopBridge, isDesktop, subscribeDesktopFiles, batchFiles, openDesktopBatch, type DesktopFile } from "./bridge";

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

describe("batchFiles", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("groups files that arrive within the window into one batch", () => {
    vi.useFakeTimers();
    const got = vi.fn();
    const b = batchFiles<string>(got, 300);
    b.add("a"); vi.advanceTimersByTime(50); b.add("b");
    vi.advanceTimersByTime(299);
    expect(got).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(got).toHaveBeenCalledTimes(1);
    expect(got).toHaveBeenCalledWith(["a", "b"]);
  });
  it("makes separate batches for files far apart", () => {
    vi.useFakeTimers();
    const got = vi.fn();
    const b = batchFiles<string>(got, 300);
    b.add("a"); vi.advanceTimersByTime(500); b.add("b"); vi.advanceTimersByTime(500);
    expect(got.mock.calls).toEqual([[["a"]], [["b"]]]);
  });
  it("flush delivers a pending batch immediately", () => {
    vi.useFakeTimers();
    const got = vi.fn();
    const b = batchFiles<string>(got, 300);
    b.add("a"); b.flush(); vi.advanceTimersByTime(1000);
    expect(got.mock.calls).toEqual([[["a"]]]);
  });
  it("cancel drops a pending batch", () => {
    vi.useFakeTimers();
    const got = vi.fn();
    const b = batchFiles<string>(got, 300);
    b.add("a"); b.cancel(); vi.advanceTimersByTime(1000);
    expect(got).not.toHaveBeenCalled();
  });
});

describe("openDesktopBatch", () => {
  const file = (n: string) => new File([new Uint8Array([1])], n);
  it("opens straight away when nothing is unsaved", () => {
    const open = vi.fn(); const ask = vi.fn();
    expect(openDesktopBatch([file("a.pdf")], false, ask, open)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("asks before discarding unsaved edits and respects a decline", () => {
    const open = vi.fn(); const ask = vi.fn(() => false);
    expect(openDesktopBatch([file("a.pdf")], true, ask, open)).toBe(false);
    expect(ask).toHaveBeenCalledWith("Discard unsaved changes and open a.pdf?");
    expect(open).not.toHaveBeenCalled();
  });
  it("names the count for several files and opens on accept", () => {
    const open = vi.fn(); const ask = vi.fn(() => true);
    openDesktopBatch([file("a.pdf"), file("b.pdf")], true, ask, open);
    expect(ask).toHaveBeenCalledWith("Discard unsaved changes and open 2 files?");
    expect(open).toHaveBeenCalledTimes(1);
  });
});
