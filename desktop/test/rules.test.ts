import { describe, it, expect } from "vitest";
import { navigationTarget, allowPermission, isOpenablePdf, pdfPathsFromArgv } from "../src/rules";
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
