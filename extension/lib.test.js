import { describe, it, expect } from "vitest";
import {
  isPdfBytes, isPdfResponse, fileNameFrom, stripFragment, handoffUrl, buildRule, RULE_ID, DEFAULT_ORIGIN,
  bytesToBase64, base64ToBytes, newToken, isFetchableUrl, canHandOff, chunkSize,
} from "./lib.js";

const ascii = (s) => new TextEncoder().encode(s);

describe("isPdfBytes", () => {
  it("finds %PDF- in the first 1024 bytes", () => {
    expect(isPdfBytes(ascii("%PDF-1.7\n..."))).toBe(true);
    const padded = new Uint8Array(1000); padded.set(ascii("%PDF-1.4"), 900);
    expect(isPdfBytes(padded)).toBe(true);
  });
  it("rejects html, empty input and a header past 1024 bytes", () => {
    expect(isPdfBytes(ascii("<!doctype html><html></html>"))).toBe(false);
    expect(isPdfBytes(new Uint8Array(0))).toBe(false);
    const late = new Uint8Array(1100); late.set(ascii("%PDF-1.4"), 1030);
    expect(isPdfBytes(late)).toBe(false);
  });
});

describe("isPdfResponse", () => {
  it("accepts a pdf content type or pdf bytes", () => {
    expect(isPdfResponse("application/pdf", ascii("junk"))).toBe(true);
    expect(isPdfResponse("Application/X-PDF; charset=binary", ascii("junk"))).toBe(true);
    expect(isPdfResponse("application/octet-stream", ascii("%PDF-1.7"))).toBe(true);
    expect(isPdfResponse(null, ascii("%PDF-1.7"))).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isPdfResponse("text/html", ascii("<html>"))).toBe(false);
    expect(isPdfResponse(null, ascii("<html>"))).toBe(false);
  });
});

describe("fileNameFrom", () => {
  it("prefers the Content-Disposition filename", () => {
    expect(fileNameFrom("https://x.test/dl?id=1", 'attachment; filename="Q3 report.pdf"')).toBe("Q3 report.pdf");
    expect(fileNameFrom("https://x.test/dl", "attachment; filename=plain.pdf")).toBe("plain.pdf");
  });
  it("prefers filename* (RFC 5987) and decodes it", () => {
    expect(fileNameFrom("https://x.test/dl", "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''na%C3%AFve%20doc.pdf")).toBe("naïve doc.pdf");
  });
  it("falls back to the decoded last path segment", () => {
    expect(fileNameFrom("https://x.test/a/My%20File.pdf?x=1")).toBe("My File.pdf");
    expect(fileNameFrom("file:///Users/me/Docs/scan.PDF")).toBe("scan.PDF");
  });
  it("adds a .pdf suffix when missing and falls back to document.pdf", () => {
    expect(fileNameFrom("https://x.test/download/12345")).toBe("12345.pdf");
    expect(fileNameFrom("https://x.test/", 'attachment; filename="report"')).toBe("report.pdf");
    expect(fileNameFrom("https://x.test/")).toBe("document.pdf");
    expect(fileNameFrom("nonsense")).toBe("document.pdf");
  });
  it("strips path separators from a hostile header filename", () => {
    expect(fileNameFrom("https://x.test/", 'attachment; filename="../../etc/passwd"')).toBe("passwd.pdf");
  });
});

describe("stripFragment", () => {
  it("removes any #fragment", () => {
    expect(stripFragment("https://x.test/a.pdf#page=3")).toBe("https://x.test/a.pdf");
    expect(stripFragment("https://x.test/a.pdf")).toBe("https://x.test/a.pdf");
  });
});

describe("handoffUrl", () => {
  it("builds <origin>/#sx=<token>&open=<url> with the url raw", () => {
    expect(handoffUrl("https://sentinelpdf.com", "tok_1", "https://x.test/a.pdf?a=1&b=2"))
      .toBe("https://sentinelpdf.com/#sx=tok_1&open=https://x.test/a.pdf?a=1&b=2");
  });
  it("tolerates a trailing slash on the origin and strips the url's fragment", () => {
    expect(handoffUrl("http://localhost:5199/", "t", "https://x.test/a.pdf#page=2")).toBe("http://localhost:5199/#sx=t&open=https://x.test/a.pdf");
  });
});

describe("buildRule", () => {
  const rule = buildRule("http://localhost:5199", "tok");
  it("redirects main-frame .pdf navigations to the hand-off url", () => {
    expect(rule.id).toBe(RULE_ID);
    expect(rule.action).toEqual({ type: "redirect", redirect: { regexSubstitution: "http://localhost:5199/#sx=tok&open=\\0" } });
    expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
    expect(rule.condition.isUrlFilterCaseSensitive).toBe(false);
  });
  it("excludes the app host (hostname only, no port)", () => {
    expect(rule.condition.excludedRequestDomains).toEqual(["localhost"]);
    expect(buildRule(DEFAULT_ORIGIN, "t").condition.excludedRequestDomains).toEqual(["sentinelpdf.com"]);
  });
  it("matches .pdf paths with an optional query and nothing else", () => {
    const re = new RegExp(rule.condition.regexFilter, "i");
    for (const u of ["https://a.test/x.pdf", "http://a.test/p/X.PDF", "https://a.test/x.pdf?dl=1&y=2"]) expect(re.test(u)).toBe(true);
    for (const u of ["https://a.test/x.pdfx", "https://a.test/x.html", "https://a.test/x.pdf/view", "file:///x.pdf", "ftp://a.test/x.pdf"]) expect(re.test(u)).toBe(false);
  });
});

describe("base64", () => {
  it("round-trips odd sizes, including sizes that would overflow spread-based encoders", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 1023, 65535, 65536, 65537, 300001, 1024 * 1024 + 1]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 255;
      const back = base64ToBytes(bytesToBase64(bytes));
      expect(back.length).toBe(n);
      expect(back.every((b, i) => b === bytes[i])).toBe(true);
    }
  });
  it("matches the standard encoding", () => {
    expect(bytesToBase64(ascii("Man"))).toBe("TWFu");
    expect(bytesToBase64(ascii("Ma"))).toBe("TWE=");
  });
  it("keeps the raw chunk size within 2 MiB", () => { expect(chunkSize).toBeLessThanOrEqual(2 * 1024 * 1024); });
});

describe("newToken", () => {
  it("is 16 random bytes in base64url", () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
});

describe("isFetchableUrl", () => {
  it("allows http, https and file only", () => {
    expect(isFetchableUrl("https://x.test/a.pdf")).toBe(true);
    expect(isFetchableUrl("http://x.test/a.pdf")).toBe(true);
    expect(isFetchableUrl("file:///a.pdf")).toBe(true);
    for (const u of ["javascript:alert(1)", "data:application/pdf;base64,AAAA", "chrome://settings", "ftp://x.test/a.pdf", "blob:https://x.test/1", "", "garbage", null, undefined]) expect(isFetchableUrl(u)).toBe(false);
  });
});

describe("canHandOff", () => {
  it("is false for browser pages and the app itself", () => {
    expect(canHandOff("https://x.test/a", "https://sentinelpdf.com")).toBe(true);
    expect(canHandOff("file:///a.pdf", "https://sentinelpdf.com")).toBe(true);
    for (const u of ["chrome://extensions", "edge://settings", "about:blank", "chrome-extension://abc/popup.html", "https://sentinelpdf.com/", "https://sentinelpdf.com/#x", undefined]) expect(canHandOff(u, "https://sentinelpdf.com")).toBe(false);
  });
});
