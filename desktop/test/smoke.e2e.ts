import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

test("the window loads the app with the bridge", async () => {
  const app = await electron.launch({ args: [resolve(__dirname, "..")] });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe("SentinelPDF");
    expect(win.url()).toMatch(/^https:\/\//);
    expect(await win.evaluate(() => typeof (window as unknown as { sentinelDesktop?: { version: string } }).sentinelDesktop?.version)).toBe("string");
    expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
  } finally {
    // exit(), not close(): quit() would raise the unsaved-changes prompt if the page objects to unloading.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
