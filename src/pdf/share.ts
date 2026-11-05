import { desktopBridge } from "../desktop/bridge";
import { saveBlob } from "./download";

export type ShareResult = "shared" | "cancelled" | "saved" | { status: "needs-gesture"; retry(): Promise<ShareResult> };

const errName = (err: unknown) => (err as { name?: string } | null)?.name;

async function shareFile(file: File): Promise<ShareResult> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (err) {
    if (errName(err) === "AbortError") return "cancelled";
    // Building the PDF can use up the transient user activation navigator.share needs; the caller offers a "Share now" click.
    if (errName(err) === "NotAllowedError") return { status: "needs-gesture", retry: () => shareFile(file) };
    throw err;
  }
}

/** Hands the PDF to the OS share sheet (desktop bridge or Web Share); downloads it when neither is available. */
export async function sharePdf(bytes: Uint8Array, name: string): Promise<ShareResult> {
  const bridge = desktopBridge();
  if (bridge?.share && (await bridge.share(name, bytes)) === "shown") return "shared";
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" });
  if (!bridge?.share && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) return shareFile(file);
  saveBlob(bytes, name);
  return "saved";
}
