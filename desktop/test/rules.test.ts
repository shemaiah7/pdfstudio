import { describe, it, expect } from "vitest";
import { navigationTarget, allowPermission, isOpenablePdf, pdfPathsFromArgv, ownerKeyFromLink, linkFromArgv } from "../src/rules";
import { APP_ORIGINS, MAX_PDF_BYTES } from "../src/config";

describe("navigationTarget", () => {
  it("keeps app pages in the window", () => {
    expect(navigationTarget("https://pdfstudio.shemaiah7.workers.dev/", APP_ORIGINS)).toBe("app");
    expect(navigationTarget("https://sentinelpdf.com/terms", APP_ORIGINS)).toBe("app");
  });
  it("sends other web links to the browser", () => {
    expect(navigationTarget("https://checkout.stripe.com/c/pay/cs_test", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("https://billing.stripe.com/p/session/x", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("http://example.com", APP_ORIGINS)).toBe("external");
  });
  it("blocks look-alikes and non-web schemes", () => {
    expect(navigationTarget("https://sentinelpdf.com.evil.io/", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("http://sentinelpdf.com/", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("file:///etc/passwd", APP_ORIGINS)).toBe("block");
    expect(navigationTarget("javascript:alert(1)", APP_ORIGINS)).toBe("block");
    expect(navigationTarget("not a url", APP_ORIGINS)).toBe("block");
  });
});

describe("allowPermission", () => {
  it("grants the microphone to the app only", () => {
    expect(allowPermission("media", "https://sentinelpdf.com/", APP_ORIGINS)).toBe(true);
    expect(allowPermission("media", "https://evil.io/", APP_ORIGINS)).toBe(false);
  });
  it("allows audio-only media and denies video", () => {
    const u = "https://sentinelpdf.com/";
    expect(allowPermission("media", u, APP_ORIGINS, ["audio"])).toBe(true);
    expect(allowPermission("media", u, APP_ORIGINS, [])).toBe(true);
    expect(allowPermission("media", u, APP_ORIGINS, ["video"])).toBe(false);
    expect(allowPermission("media", u, APP_ORIGINS, ["audio", "video"])).toBe(false);
  });
  it("allows clipboard writes from the app only", () => {
    expect(allowPermission("clipboard-sanitized-write", "https://sentinelpdf.com/", APP_ORIGINS)).toBe(true);
    expect(allowPermission("clipboard-sanitized-write", "https://evil.io/", APP_ORIGINS)).toBe(false);
    expect(allowPermission("clipboard-read", "https://sentinelpdf.com/", APP_ORIGINS)).toBe(false);
  });
  it("denies everything else", () => {
    for (const p of ["geolocation", "notifications", "camera", "midi", "openExternal"]) {
      expect(allowPermission(p, "https://sentinelpdf.com/", APP_ORIGINS)).toBe(false);
    }
  });
});

describe("isOpenablePdf", () => {
  it("accepts .pdf in any case up to 200 MB", () => {
    expect(isOpenablePdf("/Users/a/_REPORT.PDF", 1000)).toBe(true);
    expect(isOpenablePdf("C:\\Docs\\form.pdf", MAX_PDF_BYTES)).toBe(true);
  });
  it("rejects other types, empty and oversized files", () => {
    expect(isOpenablePdf("/a/notes.txt", 10)).toBe(false);
    expect(isOpenablePdf("/a/x.pdf.exe", 10)).toBe(false);
    expect(isOpenablePdf("/a/x.pdf", 0)).toBe(false);
    expect(isOpenablePdf("/a/x.pdf", MAX_PDF_BYTES + 1)).toBe(false);
  });
});

describe("pdfPathsFromArgv", () => {
  it("picks PDF paths and ignores the executable and flags", () => {
    expect(pdfPathsFromArgv(["C:\\Program Files\\SentinelPDF\\SentinelPDF.exe", "--allow-file-access", "C:\\a\\one.pdf", "C:\\b\\TWO.PDF"]))
      .toEqual(["C:\\a\\one.pdf", "C:\\b\\TWO.PDF"]);
  });
  it("returns nothing when no PDF was passed", () => {
    expect(pdfPathsFromArgv(["/Applications/SentinelPDF.app/Contents/MacOS/SentinelPDF", "-psn_0_12345"])).toEqual([]);
  });
});

describe("ownerKeyFromLink", () => {
  it("reads the key from the hash", () => {
    expect(ownerKeyFromLink("sentinelpdf://owner#abc123")).toBe("abc123");
    expect(ownerKeyFromLink("sentinelpdf://owner/#abc")).toBe("abc");
    expect(ownerKeyFromLink("SENTINELPDF://OWNER#abc")).toBe("abc");
  });
  it("decodes encoded characters", () => {
    expect(ownerKeyFromLink("sentinelpdf://owner#a%20b%2Bc%26d")).toBe("a b+c&d");
  });
  it("treats an empty key as turn off", () => {
    expect(ownerKeyFromLink("sentinelpdf://owner#")).toBe("");
    expect(ownerKeyFromLink("sentinelpdf://owner")).toBe("");
  });
  it("rejects anything else", () => {
    expect(ownerKeyFromLink("sentinelpdf://other#abc")).toBeNull();
    expect(ownerKeyFromLink("https://sentinelpdf.com/#owner=abc")).toBeNull();
    expect(ownerKeyFromLink("sentinelpdf://owner?key=abc")).toBeNull();
    expect(ownerKeyFromLink("sentinelpdf://owner#%E0%A4%A")).toBeNull();
    expect(ownerKeyFromLink("sentinelpdf://owner#" + "a".repeat(513))).toBeNull();
    expect(ownerKeyFromLink("sentinelpdf://owner#a%00b")).toBeNull();
    expect(ownerKeyFromLink("sentinelpdf://owner/extra#abc")).toBeNull();
    expect(ownerKeyFromLink("not a url")).toBeNull();
  });
  it("accepts a key of exactly 512 characters", () => {
    expect(ownerKeyFromLink("sentinelpdf://owner#" + "a".repeat(512))).toBe("a".repeat(512));
  });
});

describe("linkFromArgv", () => {
  it("finds the link in Windows-style argv", () => {
    expect(linkFromArgv(["C:\\App\\SentinelPDF.exe", "sentinelpdf://owner#abc"])).toBe("sentinelpdf://owner#abc");
    expect(linkFromArgv(["x.exe", "SentinelPDF://owner#abc"])).toBe("SentinelPDF://owner#abc");
  });
  it("returns null without one", () => {
    expect(linkFromArgv(["x.exe", "C:\\a.pdf"])).toBeNull();
  });
});

describe("pdfPathsFromArgv with links", () => {
  it("does not treat a sentinelpdf link as a PDF path", () => {
    expect(pdfPathsFromArgv(["x.exe", "sentinelpdf://owner#x.pdf"])).toEqual([]);
    expect(pdfPathsFromArgv(["x.exe", "SentinelPDF://owner#x.pdf", "C:\\a.pdf"])).toEqual(["C:\\a.pdf"]);
  });
});
