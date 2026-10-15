import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { autoUpdater } from "electron-updater";
import { APP_URL, APP_ORIGINS } from "./config";
import { allowPermission, isOpenablePdf, navigationTarget, pdfPathsFromArgv } from "./rules";
import { OpenQueue } from "./openQueue";

let win: BrowserWindow | null = null;
const queue = new OpenQueue((f) => win?.webContents.send("sentinel:open-file", f));

async function openPath(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!isOpenablePdf(path, s.size)) {
      await dialog.showMessageBox({ type: "info", message: "SentinelPDF can only open PDF files up to 200 MB." });
      return;
    }
    queue.push({ name: basename(path), bytes: new Uint8Array(await readFile(path)) });
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  } catch { /* unreadable file: ignore */ }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => { for (const p of pdfPathsFromArgv(argv)) void openPath(p); win?.focus(); });
app.on("open-file", (e, path) => { e.preventDefault(); void openPath(path); }); // macOS; may fire before ready

function openExternal(url: string): void { if (navigationTarget(url, APP_ORIGINS) === "external") void shell.openExternal(url); }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 520, title: "SentinelPDF", show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--sentinel-version=${app.getVersion()}`],
    },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
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
  win.on("closed", () => { win = null; });
  void win.loadURL(APP_URL).catch(() => {});
}

ipcMain.on("sentinel:ready", (e) => { if (win && e.sender === win.webContents) queue.markReady(); });
ipcMain.on("sentinel:retry", () => { void win?.loadURL(APP_URL).catch(() => {}); });

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(allowPermission(permission, details.requestingUrl || wc.getURL(), APP_ORIGINS)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowPermission(permission, origin, APP_ORIGINS));
  createWindow();
  for (const p of pdfPathsFromArgv(process.argv)) void openPath(p); // Windows first launch
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
