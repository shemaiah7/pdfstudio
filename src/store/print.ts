import { create } from "zustand";
import { useDocumentStore } from "./document";
import { useToolsStore } from "./tools";
import { buildOutputBytes } from "../pdf/output";
import { requireFeature } from "../components/account/useGate";

export const usePrintStore = create<{ busy: boolean }>(() => ({ busy: false }));

/** Builds the edited document exactly as Download does, then opens the system print dialog. Never marks the document clean. */
export async function printDocument(): Promise<void> {
  const s = useDocumentStore.getState();
  if (s.pages.length === 0 || usePrintStore.getState().busy) return;
  if (s.isDirty() && !requireFeature("edit")) return;
  const { setMessage } = useToolsStore.getState();
  usePrintStore.setState({ busy: true });
  try {
    setMessage("Preparing to print…");
    const bytes = await buildOutputBytes(s.pages);
    const { printPdfBytes } = await import("../pdf/print");
    await printPdfBytes(bytes, { onProgress: (done, total) => setMessage(`Preparing to print… ${done} of ${total} pages`) });
  } catch (err) {
    s.setError(`Couldn't print: ${(err as Error).message}`);
  } finally {
    setMessage(null);
    usePrintStore.setState({ busy: false });
  }
}
