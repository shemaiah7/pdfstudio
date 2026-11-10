import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

type W = Window & {
  sentinelDesktop: { onOpenFile(cb: (f: { name: string }) => void): void; onSignInTicket(cb: (t: string) => void): void; startBrowserSignIn(): void };
  __files: string[]; __tickets: string[];
};

// A link to an outside site starts a navigation that the app blocks and hands to the browser.
// The page never changes, so files opened from Finder/Explorer and sign-in links must still reach it.
test("after a link opens in the browser, opened PDFs and sign-in links still reach the page", async () => {
  const dir = mkdtempSync(tmpdir() + "/sentinel-e2e-");
  const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>stub</title>"); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const app = await electron.launch({
    args: [resolve(__dirname, "..")],
    env: { ...process.env, SENTINEL_APP_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, SENTINEL_TEST_NO_BROWSER: "1", SENTINEL_USER_DATA: dir } as Record<string, string>,
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await app.evaluate(({ shell }) => { (shell as unknown as { openExternal: (u: string) => Promise<void> }).openExternal = async (u) => { (globalThis as unknown as { __external: string }).__external = u; }; });
    await win.evaluate(() => {
      const w = window as unknown as W;
      w.__files = []; w.__tickets = [];
      w.sentinelDesktop.onOpenFile((f) => w.__files.push(f.name));
      w.sentinelDesktop.onSignInTicket((t) => w.__tickets.push(t));
    });
    const openFile = (name: string) => app.evaluate(({ app: a }, p) => { a.emit("open-file", { preventDefault() {} }, p); }, resolve(__dirname, "../../src/test/fixtures", name));

    await openFile("three.pdf");
    await expect.poll(() => win.evaluate(() => (window as unknown as W).__files)).toEqual(["three.pdf"]);

    // e.g. "Manage billing" sends the page to the Stripe portal.
    await win.evaluate(() => { window.location.assign("https://billing.stripe.com/p/session/test"); });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __external?: string }).__external ?? "")).toBe("https://billing.stripe.com/p/session/test");

    await openFile("two.pdf");
    await expect.poll(() => win.evaluate(() => (window as unknown as W).__files)).toEqual(["three.pdf", "two.pdf"]);

    await win.evaluate(() => (window as unknown as W).sentinelDesktop.startBrowserSignIn());
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl?: string }).__sentinelLastSignInUrl ?? "")).toContain("state=");
    const state = new URL(await app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl)).searchParams.get("state")!;
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, `sentinelpdf://signin?ticket=tkt_after&state=${state}`);
    await expect.poll(() => win.evaluate(() => (window as unknown as W).__tickets)).toEqual(["tkt_after"]);
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    server.close();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Electron may still hold profile files while exiting; the OS temp dir is cleaned later */ }
  }
});
