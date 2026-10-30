// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { captureOwnerKey, getOwnerKey, OWNER_STORAGE_KEY } from "./owner";

beforeEach(() => { localStorage.clear(); history.replaceState(null, "", "/"); });
afterEach(() => { vi.restoreAllMocks(); });

describe("owner key", () => {
  it("is null when nothing was captured", () => {
    expect(getOwnerKey()).toBeNull();
  });
  it("captures #owner=<key>, stores it, and strips the hash (keeping path and query)", () => {
    history.replaceState(null, "", "/app?x=1#owner=abc123");
    captureOwnerKey();
    expect(localStorage.getItem(OWNER_STORAGE_KEY)).toBe("abc123");
    expect(OWNER_STORAGE_KEY).toBe("pdfstudio.ownerKey");
    expect(getOwnerKey()).toBe("abc123");
    expect(location.hash).toBe("");
    expect(location.pathname + location.search).toBe("/app?x=1");
  });
  it("decodes a percent-encoded key", () => {
    history.replaceState(null, "", "/#owner=a%2Bb%2Fc%3D");
    captureOwnerKey();
    expect(getOwnerKey()).toBe("a+b/c=");
  });
  it("keeps other hash params when removing owner", () => {
    history.replaceState(null, "", "/#foo=1&owner=k1");
    captureOwnerKey();
    expect(getOwnerKey()).toBe("k1");
    expect(location.hash).toBe("#foo=1");
  });
  it("clears the stored key with an empty #owner=", () => {
    localStorage.setItem(OWNER_STORAGE_KEY, "old");
    history.replaceState(null, "", "/#owner=");
    captureOwnerKey();
    expect(getOwnerKey()).toBeNull();
    expect(localStorage.getItem(OWNER_STORAGE_KEY)).toBeNull();
    expect(location.hash).toBe("");
  });
  it("leaves storage and the hash alone when there is no owner param", () => {
    localStorage.setItem(OWNER_STORAGE_KEY, "keep");
    history.replaceState(null, "", "/#section");
    captureOwnerKey();
    expect(getOwnerKey()).toBe("keep");
    expect(location.hash).toBe("#section");
  });
  it("returns early for extension hand-off links, even when the URL contains owner=", () => {
    localStorage.setItem(OWNER_STORAGE_KEY, "keep");
    history.replaceState(null, "", "/#sx=tok&open=https://x.test/a.pdf?a=1&owner=evil");
    captureOwnerKey();
    expect(getOwnerKey()).toBe("keep");
    expect(location.hash).toBe("#sx=tok&open=https://x.test/a.pdf?a=1&owner=evil");
    history.replaceState(null, "", "/#open=https://x.test/a.pdf?owner=evil");
    captureOwnerKey();
    expect(getOwnerKey()).toBe("keep");
    expect(location.hash).toBe("#open=https://x.test/a.pdf?owner=evil");
  });
  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    history.replaceState(null, "", "/#owner=zzz");
    expect(() => captureOwnerKey()).not.toThrow();
    expect(location.hash).toBe("");
    expect(getOwnerKey()).toBeNull();
    history.replaceState(null, "", "/#owner=");
    expect(() => captureOwnerKey()).not.toThrow();
  });
});
