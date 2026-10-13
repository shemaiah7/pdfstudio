// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { desktopOs, promptDone, markPromptDone } from "./defaultApp";

const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("desktopOs", () => {
  it("detects Mac Chrome and Windows Edge", () => {
    expect(desktopOs({ ua: MAC_CHROME, platform: "MacIntel", maxTouchPoints: 0 })).toBe("mac");
    expect(desktopOs({ ua: WIN_EDGE, platform: "Win32", maxTouchPoints: 0 })).toBe("windows");
  });
  it("returns null for Safari Mac, iPad, Android, Linux", () => {
    expect(desktopOs({ ua: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 })).toBeNull();
    expect(desktopOs({ ua: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 })).toBeNull();
    expect(desktopOs({ ua: ANDROID, platform: "Linux armv81", maxTouchPoints: 5 })).toBeNull();
    expect(desktopOs({ ua: LINUX, platform: "Linux x86_64", maxTouchPoints: 0 })).toBeNull();
  });
});

describe("prompt storage", () => {
  it("round-trips", () => {
    expect(promptDone()).toBe(false);
    markPromptDone();
    expect(promptDone()).toBe(true);
  });
  it("tolerates throwing storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(promptDone()).toBe(false);
    expect(() => markPromptDone()).not.toThrow();
  });
});
