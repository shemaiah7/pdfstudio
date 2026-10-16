import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("browser sign-in: matching state delivers the ticket once", async () => {
  const dir = mkdtempSync(tmpdir() + "/sentinel-e2e-");
  const app = await electron.launch({
    args: [resolve(__dirname, "..")],
    env: {
      ...process.env,
      SENTINEL_APP_URL: "https://pdfstudio.shemaiah7.workers.dev",
      SENTINEL_TEST_NO_BROWSER: "1",
      SENTINEL_USER_DATA: dir,
    } as Record<string, string>,
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.evaluate(() => {
      const w = window as unknown as { sentinelDesktop: { onSignInTicket(cb: (t: string) => void): void; onSignInFailed(cb: (r: string) => void): void; startBrowserSignIn(): void }; __got: string[]; __failed: string[] };
      w.__got = []; w.__failed = [];
      w.sentinelDesktop.onSignInTicket((t) => w.__got.push(t));
      w.sentinelDesktop.onSignInFailed((r) => w.__failed.push(r));
      w.sentinelDesktop.startBrowserSignIn();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl?: string }).__sentinelLastSignInUrl ?? "")).toContain("/desktop-signin?state=");
    const opened = await app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl);
    const state = new URL(opened).searchParams.get("state")!;
    const link = `sentinelpdf://signin?ticket=tkt_test&state=${state}`;
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, link);
    await expect.poll(() => win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_test"]);
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, link);
    await expect.poll(() => win.evaluate(() => (window as unknown as { __failed: string[] }).__failed)).toEqual(["expired"]);
    expect(await win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_test"]);
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browser sign-in: a link that arrives before the page subscribes is held and delivered once", async () => {
  const dir = mkdtempSync(tmpdir() + "/sentinel-e2e-");
  const app = await electron.launch({
    args: [resolve(__dirname, "..")],
    env: {
      ...process.env,
      SENTINEL_APP_URL: "https://pdfstudio.shemaiah7.workers.dev",
      SENTINEL_TEST_NO_BROWSER: "1",
      SENTINEL_USER_DATA: dir,
    } as Record<string, string>,
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.evaluate(() => (window as unknown as { sentinelDesktop: { startBrowserSignIn(): void } }).sentinelDesktop.startBrowserSignIn());
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl?: string }).__sentinelLastSignInUrl ?? "")).toContain("/desktop-signin?state=");
    const opened = await app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl);
    const state = new URL(opened).searchParams.get("state")!;
    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    // The link lands while no listener is subscribed yet.
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, `sentinelpdf://signin?ticket=tkt_early&state=${state}`);
    await win.waitForTimeout(500);
    await win.evaluate(() => {
      const w = window as unknown as { sentinelDesktop: { onSignInTicket(cb: (t: string) => void): void }; __got: string[] };
      w.__got = [];
      w.sentinelDesktop.onSignInTicket((t) => w.__got.push(t));
    });
    await expect.poll(() => win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_early"]);
    await win.waitForTimeout(500);
    expect(await win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_early"]);
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});
