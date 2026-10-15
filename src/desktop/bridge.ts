export interface DesktopFile { name: string; bytes: Uint8Array }
export interface DesktopBridge { version: string; onOpenFile(cb: (f: DesktopFile) => void): () => void; retry?: () => void }

/** The Electron preload exposes window.sentinelDesktop; absent in normal browsers. */
export const desktopBridge = (): DesktopBridge | null =>
  typeof window === "undefined" ? null : ((window as Window & { sentinelDesktop?: DesktopBridge }).sentinelDesktop ?? null);

export const isDesktop = (): boolean => desktopBridge() !== null;

export function subscribeDesktopFiles(onFiles: (files: File[]) => void): () => void {
  const bridge = desktopBridge();
  if (!bridge) return () => {};
  return bridge.onOpenFile(({ name, bytes }) => onFiles([new File([bytes as BlobPart], name, { type: "application/pdf" })]));
}
