import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type OpenedFile = { name: string; bytes: Uint8Array };
const listeners = new Set<(f: OpenedFile) => void>();
ipcRenderer.on("sentinel:open-file", (_e: IpcRendererEvent, f: OpenedFile) => { for (const cb of listeners) cb(f); });
const version = process.argv.find((a) => a.startsWith("--sentinel-version="))?.split("=")[1] ?? "";

contextBridge.exposeInMainWorld("sentinelDesktop", {
  version,
  onOpenFile(cb: (f: OpenedFile) => void) {
    listeners.add(cb);
    ipcRenderer.send("sentinel:ready");
    return () => { listeners.delete(cb); };
  },
  retry: () => ipcRenderer.send("sentinel:retry"),
});
