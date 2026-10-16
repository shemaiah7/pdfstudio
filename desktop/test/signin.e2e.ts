import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// A local stub page, so these specs never depend on (or get consumed by) the deployed site.
async function startStub(dir: string): Promise<{ url: string; server: Server }> {
  writeFileSync(dir + "/stub.html", "<!doctype html><title>stub</title>");
  const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>stub</title>"); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}/`, server };
}

test("browser sign-in: matching state delivers the ticket once", async () => {
  const dir = mkdtempSync(tmpdir() + "/sentinel-e2e-");
  const stub = await startStub(dir);
  const app = await electron.launch({
    args: [resolve(__dirname, "..")],
    env: {
      ...process.env,
      SENTINEL_APP_URL: stub.url,
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
    stub.server.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("browser sign-in: a link that arrives before the page subscribes is held and delivered once", async () => {
  const dir = mkdtempSync(tmpdir() + "/sentinel-e2e-");
  const stub = await startStub(dir);
  const app = await electron.launch({
    args: [resolve(__dirname, "..")],
    env: {
      ...process.env,
      SENTINEL_APP_URL: stub.url,
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
    // A same-document navigation must not reset readiness: a second sign-in still delivers.
    await win.evaluate(() => { history.replaceState(null, "", location.pathname + "?x=1"); (window as unknown as { sentinelDesktop: { startBrowserSignIn(): void } }).sentinelDesktop.startBrowserSignIn(); });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl?: string }).__sentinelLastSignInUrl ?? "")).not.toContain(state);
    const state2 = new URL(await app.evaluate(() => (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl)).searchParams.get("state")!;
    await app.evaluate(({ app: a }, l) => { a.emit("open-url", { preventDefault() {} }, l); }, `sentinelpdf://signin?ticket=tkt_two&state=${state2}`);
    await expect.poll(() => win.evaluate(() => (window as unknown as { __got: string[] }).__got)).toEqual(["tkt_early", "tkt_two"]);
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    stub.server.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
