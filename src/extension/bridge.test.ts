// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  pendingOpenUrl, pendingOpenToken, clearOpenHash, subscribeExtensionBridge, messageFor, fileNameFrom,
  watchPendingOpen, openOriginalMessage, TIMEOUT_MESSAGE, EXTENSION_INSTALL_URL,
} from "./bridge";

const send = (data: unknown, over: { origin?: string; source?: unknown } = {}) =>
  window.dispatchEvent(new MessageEvent("message", { data, origin: over.origin ?? location.origin, source: ("source" in over ? over.source : window) as MessageEventSource }));

beforeEach(() => { history.replaceState(null, "", "/"); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("pendingOpenUrl / pendingOpenToken", () => {
  it("is null without an open= field", () => {
    expect(pendingOpenUrl("")).toBeNull();
    expect(pendingOpenUrl("#owner=abc")).toBeNull();
    expect(pendingOpenUrl("#sx=tok")).toBeNull();
    expect(pendingOpenUrl("#open=")).toBeNull();
  });
  it("returns the raw URL after open=", () => {
    expect(pendingOpenUrl("#open=https://example.com/a.pdf")).toBe("https://example.com/a.pdf");
  });
  it("keeps & and further open= inside the URL", () => {
    expect(pendingOpenUrl("#sx=tok&open=https://x.test/a.pdf?a=1&open=2&b=3")).toBe("https://x.test/a.pdf?a=1&open=2&b=3");
  });
  it("reads the token and does not mistake text inside the URL for it", () => {
    expect(pendingOpenToken("#sx=abc_-123&open=https://x.test/a.pdf?sx=evil")).toBe("abc_-123");
    expect(pendingOpenToken("#open=https://x.test/a.pdf?sx=evil")).toBeNull();
    expect(pendingOpenToken("")).toBeNull();
  });
  it("defaults to location.hash", () => {
    history.replaceState(null, "", "/#sx=t&open=https://x.test/b.pdf");
    expect(pendingOpenUrl()).toBe("https://x.test/b.pdf");
    expect(pendingOpenToken()).toBe("t");
  });
});

describe("clearOpenHash", () => {
  it("removes the fragment and keeps path and query", () => {
    history.replaceState(null, "", "/app?x=1#sx=t&open=https://x.test/a.pdf");
    clearOpenHash();
    expect(location.hash).toBe("");
    expect(location.pathname + location.search).toBe("/app?x=1");
  });
});

describe("messageFor", () => {
  it("maps each reason", () => {
    expect(messageFor("not-pdf")).toBe("That link isn't a PDF.");
    expect(messageFor("file-access")).toContain("Allow access to file URLs");
    expect(messageFor("http-404")).toBe("Couldn't fetch the PDF (HTTP 404). Open it the usual way and use the SentinelPDF button on that page.");
    expect(messageFor("network")).toBe("Couldn't fetch the PDF. Check the link or your connection.");
    expect(messageFor("untrusted")).toBe("This link wasn't opened by the SentinelPDF extension. Open the PDF in a tab and use the SentinelPDF toolbar button.");
    expect(messageFor("???")).toMatch(/couldn't open/i);
    expect(messageFor(undefined)).toMatch(/couldn't open/i);
  });
});

describe("fileNameFrom", () => {
  it("uses the last path segment, decoded, with a .pdf fallback", () => {
    expect(fileNameFrom("https://x.test/a/My%20Report.pdf?x=1")).toBe("My Report.pdf");
    expect(fileNameFrom("https://x.test/")).toBe("document.pdf");
    expect(fileNameFrom("not a url")).toBe("document.pdf");
  });
});

describe("subscribeExtensionBridge", () => {
  const handlers = () => ({ onFetching: vi.fn(), onFiles: vi.fn(), onError: vi.fn() });

  it("posts ready on subscribe and unsubscribes", () => {
    const spy = vi.spyOn(window, "postMessage");
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    expect(spy).toHaveBeenCalledWith({ v: 1, type: "sentinelpdf:ready" }, location.origin);
    off();
    send({ v: 1, type: "sentinelpdf:fetching", url: "https://x.test/a.pdf" });
    expect(h.onFetching).not.toHaveBeenCalled();
  });

  it("answers a ping with ready", () => {
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    const spy = vi.spyOn(window, "postMessage");
    send({ v: 1, type: "sentinelpdf:ping" });
    expect(spy).toHaveBeenCalledWith({ v: 1, type: "sentinelpdf:ready" }, location.origin);
    off();
  });

  it("reports fetching with the file name", () => {
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    send({ v: 1, type: "sentinelpdf:fetching", url: "https://x.test/docs/a.pdf" });
    expect(h.onFetching).toHaveBeenCalledWith("a.pdf");
    off();
  });

  it("turns open-file into a PDF File", async () => {
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    send({ v: 1, type: "sentinelpdf:open-file", name: "r.pdf", bytes: new Uint8Array([37, 80, 68, 70]).buffer });
    const files = h.onFiles.mock.calls[0][0] as File[];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("r.pdf");
    expect(files[0].type).toBe("application/pdf");
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    off();
  });

  it("turns open-error into a message plus the reason and url", () => {
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    send({ v: 1, type: "sentinelpdf:open-error", reason: "not-pdf", url: "https://x.test/a.pdf" });
    expect(h.onError).toHaveBeenCalledWith("That link isn't a PDF.", { reason: "not-pdf", url: "https://x.test/a.pdf" });
    off();
  });

  it("ignores a wrong origin, a wrong source, a missing or wrong v, and unknown types", () => {
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    const ok = { v: 1, type: "sentinelpdf:open-error", reason: "network", url: "u" };
    send(ok, { origin: "https://evil.test" });
    send(ok, { source: null });
    send({ ...ok, v: undefined });
    send({ ...ok, v: 2 });
    send({ v: 1, type: "sentinelpdf:other" });
    send("sentinelpdf:open-error");
    send(null);
    expect(h.onError).not.toHaveBeenCalled();
    send(ok);
    expect(h.onError).toHaveBeenCalledTimes(1);
    off();
  });

  it("ignores open-file with bad payloads", () => {
    const h = handlers();
    const off = subscribeExtensionBridge(h);
    send({ v: 1, type: "sentinelpdf:open-file", name: "a.pdf", bytes: "nope" });
    send({ v: 1, type: "sentinelpdf:open-file", bytes: new ArrayBuffer(1) });
    expect(h.onFiles).not.toHaveBeenCalled();
    off();
  });
});

describe("openOriginalMessage", () => {
  it("builds the versioned open-original message", () => {
    expect(openOriginalMessage("https://x.test/a.pdf")).toEqual({ v: 1, type: "sentinelpdf:open-original", url: "https://x.test/a.pdf" });
  });
});

describe("watchPendingOpen", () => {
  it("fires after the timeout when an open link is pending", () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/#sx=t&open=https://x.test/a.pdf");
    const onTimeout = vi.fn();
    watchPendingOpen(onTimeout, 8000);
    vi.advanceTimersByTime(7999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(TIMEOUT_MESSAGE).toBe("Couldn't reach the SentinelPDF browser extension. Install it, or open the PDF the usual way.");
  });
  it("does nothing without a pending hash", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    watchPendingOpen(onTimeout, 8000);
    vi.advanceTimersByTime(20000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
  it("can be cancelled", () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/#open=https://x.test/a.pdf");
    const onTimeout = vi.fn();
    watchPendingOpen(onTimeout, 8000).cancel();
    vi.advanceTimersByTime(20000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("EXTENSION_INSTALL_URL", () => {
  it("is null until the listing exists", () => { expect(EXTENSION_INSTALL_URL).toBeNull(); });
});
