// src/live/mics.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { listMics, resolveMic, getSavedMic, saveMic, onDeviceChange, MIC_KEY } from "./mics";

const dev = (deviceId: string, label: string, kind = "audioinput") => ({ deviceId, label, kind, groupId: "" }) as MediaDeviceInfo;
function stubMedia(devices: MediaDeviceInfo[] | Error) {
  const listeners = new Set<() => void>();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: async () => { if (devices instanceof Error) throw devices; return devices; },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    },
  });
  return listeners;
}
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); Reflect.deleteProperty(navigator, "mediaDevices"); });

describe("listMics", () => {
  it("returns audio inputs, skips pseudo-ids and other kinds", async () => {
    stubMedia([dev("default", "Default - X"), dev("communications", "Comms"), dev("a", "MacBook Mic"), dev("v", "Cam", "videoinput"), dev("o", "Spk", "audiooutput")]);
    expect(await listMics()).toEqual([{ deviceId: "a", label: "MacBook Mic" }]);
  });
  it("falls back to numbered labels when permission has not been granted", async () => {
    stubMedia([dev("a", ""), dev("b", "")]);
    expect(await listMics()).toEqual([{ deviceId: "a", label: "Microphone 1" }, { deviceId: "b", label: "Microphone 2" }]);
  });
  it("returns [] without mediaDevices or when enumeration fails", async () => {
    expect(await listMics()).toEqual([]);
    stubMedia(new Error("nope"));
    expect(await listMics()).toEqual([]);
  });
});

describe("resolveMic", () => {
  const list = [{ deviceId: "a", label: "A" }];
  it("keeps a present preference, falls back silently otherwise", () => {
    expect(resolveMic("a", list)).toBe("a");
    expect(resolveMic("gone", list)).toBeUndefined();
    expect(resolveMic(null, list)).toBeUndefined();
  });
});

describe("preference storage", () => {
  it("round-trips and clears", () => {
    expect(getSavedMic()).toBeNull();
    saveMic("a"); expect(localStorage.getItem(MIC_KEY)).toBe("a"); expect(getSavedMic()).toBe("a");
    saveMic(null); expect(getSavedMic()).toBeNull();
  });
  it("never throws when storage does", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getSavedMic()).toBeNull();
    expect(() => saveMic("a")).not.toThrow();
    expect(() => saveMic(null)).not.toThrow();
  });
});

describe("onDeviceChange", () => {
  it("subscribes to devicechange and unsubscribes", () => {
    const listeners = stubMedia([]);
    const off = onDeviceChange(() => {});
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
  it("is a no-op without mediaDevices", () => { expect(() => onDeviceChange(() => {})()).not.toThrow(); });
});
