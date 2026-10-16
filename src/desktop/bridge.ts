export interface DesktopFile { name: string; bytes: Uint8Array }
export interface DesktopBridge {
  version: string;
  onOpenFile(cb: (f: DesktopFile) => void): () => void;
  retry?: () => void;
  startBrowserSignIn?(): void;
  onSignInTicket?(cb: (ticket: string) => void): () => void;
  onSignInFailed?(cb: (reason: "expired") => void): () => void;
}

/** The Electron preload exposes window.sentinelDesktop; absent in normal browsers. */
export const desktopBridge = (): DesktopBridge | null =>
  typeof window === "undefined" ? null : ((window as Window & { sentinelDesktop?: DesktopBridge }).sentinelDesktop ?? null);

export const isDesktop = (): boolean => desktopBridge() !== null;

export const canBrowserSignIn = (): boolean => typeof desktopBridge()?.startBrowserSignIn === "function";

export function subscribeDesktopFiles(onFiles: (files: File[]) => void): () => void {
  const bridge = desktopBridge();
  if (!bridge) return () => {};
  return bridge.onOpenFile(({ name, bytes }) => onFiles([new File([bytes as BlobPart], name, { type: "application/pdf" })]));
}

/** Groups items that arrive within `ms` of each other (a multi-file open) into one batch. */
export function batchFiles<T>(onBatch: (items: T[]) => void, ms = 300): { add(item: T): void; flush(): void; cancel(): void } {
  let items: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (items.length === 0) return;
    const b = items; items = []; onBatch(b);
  };
  return {
    add(item) {
      items.push(item);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    flush,
    cancel() { if (timer) clearTimeout(timer); timer = null; items = []; },
  };
}

/** Opening replaces the current document, so confirm first when it has unsaved edits. Returns whether it opened. */
export function openDesktopBatch(files: File[], isDirty: boolean, confirmFn: (msg: string) => boolean, open: (files: File[]) => void): boolean {
  if (files.length === 0) return false;
  if (isDirty && !confirmFn("Discard unsaved changes and open " + (files.length === 1 ? files[0].name : files.length + " files") + "?")) return false;
  open(files);
  return true;
}
