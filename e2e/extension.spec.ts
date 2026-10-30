import { test, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

// Loads the development build of the browser extension (scripts/extension-dev.sh) in its own Chromium
// profile, in its own file so the extension context cannot affect the other specs.
const APP = "http://localhost:5199";
const EXT_DIR = resolve("extension/dist/dev");
const FIXTURE = readFileSync(resolve("src/test/fixtures/two.pdf"));

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let sw: Worker;
let userDir: string;
let host: Server;
let origin: string; // http://127.0.0.1:<port>; deliberately not "localhost", which the redirect rule excludes

test.beforeAll(async () => {
  execFileSync("sh", ["scripts/extension-dev.sh"], { stdio: "pipe" });

  host = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/two.pdf") { res.writeHead(200, { "Content-Type": "application/pdf" }); res.end(FIXTURE); }
    else if (path === "/fake.pdf") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>not a pdf</title><p id=\"plain\">plain page</p>"); }
    else { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("nope"); }
  });
  await new Promise<void>((ok) => host.listen(0, "127.0.0.1", ok));
  origin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;

  userDir = mkdtempSync(join(tmpdir(), "sentinel-ext-"));
  // channel "chromium" is Playwright's new headless mode, the only one that loads extensions.
  context = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await sw.evaluate((o) => chrome.storage.local.set({ appOrigin: o }), APP);
  await rulesAre(true);
});

test.afterAll(async () => {
  await context?.close();
  host?.close();
  if (userDir) rmSync(userDir, { recursive: true, force: true });
});

/** Storage changes rebuild the redirect rule asynchronously, so wait for the rule set rather than the write. */
async function rulesAre(on: boolean) {
  await expect.poll(async () => {
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    if (!on) return rules.length === 0;
    return rules.length === 1 && rules[0].action.redirect?.regexSubstitution?.startsWith(`${APP}/#sx=`) === true;
  }, { timeout: 15_000 }).toBe(true);
}

const sessionToken = async () => (await sw.evaluate(() => chrome.storage.session.get("token"))).token as string;

async function openFresh(): Promise<Page> {
  const page = await context.newPage();
  return page;
}

test("a .pdf link opens in SentinelPDF", async () => {
  const page = await openFresh();
  await page.goto(`${origin}/two.pdf`);
  await page.waitForURL(`${APP}/**`);
  await expect(page.getByTestId("thumb")).toHaveCount(2);
  // The hand-off hash (token and the PDF's URL) is removed once the document is open.
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.close();
});

test("a .pdf URL that is not a PDF ends in a message and a way out, not a loop", async () => {
  const page = await openFresh();
  await page.goto(`${origin}/fake.pdf`);
  await page.waitForURL(`${APP}/**`);
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("That link isn't a PDF.");
  await banner.getByRole("button", { name: "Open it without SentinelPDF" }).click();
  await page.waitForURL(`${origin}/fake.pdf`);
  await expect(page.locator("#plain")).toHaveText("plain page");
  // The redirect rule comes back about 5 s afterwards.
  await rulesAre(true);
  await page.close();
});

test("a hand-off link not minted by the extension is refused", async () => {
  const page = await openFresh();
  await page.goto(`${APP}/#open=${origin}/two.pdf`);
  await expect(page.getByRole("alert")).toContainText("wasn't opened by the SentinelPDF extension");
  await expect(page.getByTestId("thumb")).toHaveCount(0);
  await page.close();
});

test("an HTTP error from the target shows the banner", async () => {
  const page = await openFresh();
  await page.goto(`${APP}/#sx=${await sessionToken()}&open=${origin}/missing`);
  await expect(page.getByRole("alert")).toContainText("HTTP 404");
  await page.close();
});

test("with automatic opening off, a .pdf URL stays where it is", async () => {
  await sw.evaluate(() => chrome.storage.sync.set({ autoOpen: false }));
  await rulesAre(false);
  try {
    const page = await openFresh();
    // Chromium may show its own viewer or start a download here; either way the page must not be redirected.
    const seen: string[] = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) seen.push(f.url()); });
    await page.goto(`${origin}/two.pdf`).catch(() => {});
    await page.waitForTimeout(500);
    expect(seen.some((u) => u.startsWith(APP))).toBe(false);
    await page.close();
  } finally {
    await sw.evaluate(() => chrome.storage.sync.set({ autoOpen: true }));
    await rulesAre(true);
  }
});

test("the popup toggle turns automatic opening off and on", async () => {
  const id = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const auto = popup.locator("#auto");
  await expect(auto).toBeChecked();
  await auto.uncheck();
  await rulesAre(false);
  await auto.check();
  await rulesAre(true);
  // Opened as a tab of its own, the active page is an extension page, which can't be sent.
  await expect(popup.locator("#open")).toBeDisabled();
  await popup.close();
});

test("without the extension, a hand-off link ends in the install message and the hash is cleared", async ({ page }) => {
  await page.goto(`${APP}/#sx=none&open=https://example.com/a.pdf`);
  await expect(page.getByRole("alert")).toContainText("Couldn't reach the SentinelPDF browser extension", { timeout: 15_000 });
  expect(new URL(page.url()).hash).toBe("");
});
