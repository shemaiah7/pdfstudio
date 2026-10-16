import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type OpenedFile = { name: string; bytes: Uint8Array };
const listeners = new Set<(f: OpenedFile) => void>();
ipcRenderer.on("sentinel:open-file", (_e: IpcRendererEvent, f: OpenedFile) => { for (const cb of listeners) cb(f); });
const ticketListeners = new Set<(t: string) => void>();
const failedListeners = new Set<(r: "expired") => void>();
ipcRenderer.on("sentinel:signin-ticket", (_e: IpcRendererEvent, t: string) => { for (const cb of ticketListeners) cb(t); });
ipcRenderer.on("sentinel:signin-failed", (_e: IpcRendererEvent, r: "expired") => { for (const cb of failedListeners) cb(r); });
const version = process.argv.find((a) => a.startsWith("--sentinel-version="))?.split("=")[1] ?? "";

contextBridge.exposeInMainWorld("sentinelDesktop", {
  version,
  onOpenFile(cb: (f: OpenedFile) => void) {
    listeners.add(cb);
    ipcRenderer.send("sentinel:ready");
    return () => { listeners.delete(cb); };
  },
  retry: () => ipcRenderer.send("sentinel:retry"),
  startBrowserSignIn: () => ipcRenderer.send("sentinel:start-browser-signin"),
  onSignInTicket(cb: (t: string) => void) { ticketListeners.add(cb); ipcRenderer.send("sentinel:signin-ready"); return () => { ticketListeners.delete(cb); }; },
  onSignInFailed(cb: (r: "expired") => void) { failedListeners.add(cb); return () => { failedListeners.delete(cb); }; },
});
