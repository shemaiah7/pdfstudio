import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { autoUpdater } from "electron-updater";
import { APP_URL, APP_ORIGINS } from "./config";
import { allowPermission, isOpenablePdf, navigationTarget, pdfPathsFromArgv, ownerKeyFromLink, linkFromArgv, LINK_SCHEME } from "./rules";
import { OpenQueue } from "./openQueue";
import { randomBytes } from "node:crypto";
import { createPendingSignIn, signInLinkFrom, consumeSignIn, type PendingSignIn } from "./signin";

// Test-only: lets an e2e run use its own profile (and single-instance lock) beside an installed copy.
if (!app.isPackaged && process.env.SENTINEL_USER_DATA) app.setPath("userData", process.env.SENTINEL_USER_DATA);

let win: BrowserWindow | null = null;
let pendingSignIn: PendingSignIn | null = null;
const queue = new OpenQueue((f) => win?.webContents.send("sentinel:open-file", f));

async function openPath(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!isOpenablePdf(path, s.size)) {
      await dialog.showMessageBox({ type: "info", message: "SentinelPDF can only open PDF files up to 200 MB." });
      return;
    }
    const file = { name: basename(path), bytes: new Uint8Array(await readFile(path)) };
    await app.whenReady(); // macOS can deliver open-file before ready
    queue.push(file);
    if (!win) createWindow();
    else { if (win.isMinimized()) win.restore(); win.focus(); }
  } catch { /* unreadable file: ignore */ }
}

const url = !app.isPackaged && process.env.SENTINEL_APP_URL ? process.env.SENTINEL_APP_URL : APP_URL;

async function handleOwnerLink(link: string): Promise<void> {
  try {
    const key = ownerKeyFromLink(link);
    if (key === null) return;
    await app.whenReady();
    if (!win) createWindow();
    else { if (win.isMinimized()) win.restore(); win.focus(); }
    const { response } = await dialog.showMessageBox(win!, {
      type: "question",
      buttons: [key ? "Turn on" : "Turn off", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: key ? "Turn on owner access on this computer?" : "Turn off owner access on this computer?",
      detail: "Only do this with a link you created yourself.",
    });
    if (response === 0) {
      // A query change forces a full navigation; a fragment-only change would not reload the page.
      const target = new URL(url);
      target.searchParams.set("owner-link", String(Date.now())); // unique each time, so a repeat link also reloads
      target.hash = `owner=${encodeURIComponent(key)}`;
      void win?.loadURL(target.toString()).catch(() => {});
    }
  } catch { /* a bad link must never crash the app */ }
}

async function startBrowserSignIn(): Promise<void> {
  pendingSignIn = createPendingSignIn(Date.now(), (n) => new Uint8Array(randomBytes(n)));
  const target = new URL("/desktop-signin", url);
  target.searchParams.set("state", pendingSignIn.state);
  if (!app.isPackaged && process.env.SENTINEL_TEST_NO_BROWSER === "1") { (globalThis as unknown as { __sentinelLastSignInUrl: string }).__sentinelLastSignInUrl = target.toString(); return; }
  await shell.openExternal(target.toString()).catch(() => {});
}

async function handleSignInLink(link: string): Promise<boolean> {
  const parsed = signInLinkFrom(link);
  if (!parsed) return false;
  await app.whenReady();
  if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.focus(); }
  const result = consumeSignIn(pendingSignIn, parsed, Date.now());
  if (result === "ok") { pendingSignIn = null; win?.webContents.send("sentinel:signin-ticket", parsed.ticket); }
  else win?.webContents.send("sentinel:signin-failed", "expired");
  return true;
}

async function handleLink(link: string): Promise<void> {
  if (await handleSignInLink(link)) return;
  await handleOwnerLink(link);
}

function openExternal(url: string): void { if (navigationTarget(url, APP_ORIGINS) === "external") void shell.openExternal(url); }

function createWindow(): void {
  if (win) return;
  queue.markNotReady();
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 520, title: "SentinelPDF", show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--sentinel-version=${app.getVersion()}`],
    },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url); // any web link, including app origins, opens in the browser
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:") && url.endsWith("offline.html")) return;
    if (navigationTarget(url, APP_ORIGINS) !== "app") { e.preventDefault(); openExternal(url); }
  });
  win.webContents.on("will-redirect", (e, url, _inPlace, isMainFrame) => {
    if (isMainFrame && navigationTarget(url, APP_ORIGINS) !== "app") { e.preventDefault(); openExternal(url); }
  });
  win.webContents.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) queue.markNotReady(); });
  win.webContents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) void win?.loadFile(join(__dirname, "..", "offline.html")).catch(() => {});
  });
  // Electron silently cancels a close when the page's beforeunload objects; ask instead, so the window can always be closed.
  win.webContents.on("will-prevent-unload", (e) => {
    const cancel = dialog.showMessageBoxSync(win!, { type: "question", buttons: ["Discard", "Cancel"], defaultId: 1, cancelId: 1, message: "Discard unsaved changes?" }) === 1;
    if (!cancel) e.preventDefault(); // preventDefault here means: proceed with the unload
  });
  win.on("closed", () => { win = null; queue.markNotReady(); });
  void win.loadURL(url).catch(() => {});
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  if (app.isPackaged) app.setAsDefaultProtocolClient(LINK_SCHEME);
  app.on("second-instance", (_e, argv) => {
    for (const p of pdfPathsFromArgv(argv)) void openPath(p);
    const link = linkFromArgv(argv);
    if (link) void handleLink(link);
    win?.focus();
  });
  app.on("open-file", (e, path) => { e.preventDefault(); void openPath(path); }); // macOS; may fire before ready
  app.on("open-url", (e, link) => { e.preventDefault(); void handleLink(link); }); // macOS; may fire before ready

  ipcMain.on("sentinel:ready", (e) => {
    if (win && e.sender === win.webContents) { try { queue.markReady(); } catch { /* undelivered files stay queued */ } }
  });
  ipcMain.on("sentinel:start-browser-signin", (e) => { if (win && e.sender === win.webContents) void startBrowserSignIn(); });
  ipcMain.on("sentinel:retry", (e) => { if (win && e.sender === win.webContents) void win.loadURL(url).catch(() => {}); });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) =>
      cb(allowPermission(permission, details.requestingUrl || wc.getURL(), APP_ORIGINS, "mediaTypes" in details ? details.mediaTypes : undefined)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowPermission(permission, origin, APP_ORIGINS));
    createWindow();
    for (const p of pdfPathsFromArgv(process.argv)) void openPath(p); // Windows first launch
    const firstLink = linkFromArgv(process.argv);
    if (firstLink) void handleLink(firstLink);
    if (app.isPackaged) {
      autoUpdater.on("error", () => {});
      autoUpdater.on("update-downloaded", async () => {
        const r = await dialog.showMessageBox({ type: "info", buttons: ["Restart to update", "Later"], defaultId: 0, message: "A SentinelPDF update is ready." });
        if (r.response === 0) autoUpdater.quitAndInstall();
      });
      void autoUpdater.checkForUpdates().catch(() => {});
      setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
    }
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => { if (!win) createWindow(); });
}
