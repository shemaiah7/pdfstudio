import { create } from "zustand";
import { useDocumentStore } from "./document";
import { useToolsStore } from "./tools";
import { buildOutputBytes } from "../pdf/output";
import { sharePdf, type ShareResult } from "../pdf/share";
import { outputName } from "../pdf/download";
import { requireFeature } from "../components/account/useGate";

export const useShareStore = create<{ busy: boolean }>(() => ({ busy: false }));

function report(result: ShareResult, name: string) {
  const s = useDocumentStore.getState();
  if (result === "saved") useToolsStore.getState().setMessage(`Saved ${name}. Attach it to an email from your Downloads folder.`);
  else if (typeof result === "object") {
    s.setError("Your PDF is ready to share.", {
      label: "Share now",
      run: () => { void result.retry().then((r) => { s.setError(null); report(r, name); }).catch((err) => s.setError(`Couldn't share: ${(err as Error).message}`)); },
    });
  }
}

/** Builds the edited document exactly as Download does and hands it to the share sheet. Never marks the document clean. */
export async function shareDocument(): Promise<void> {
  const s = useDocumentStore.getState();
  if (s.pages.length === 0 || useShareStore.getState().busy) return;
  if (s.isDirty() && !requireFeature("edit")) return;
  useShareStore.setState({ busy: true });
  try {
    const name = outputName(s.sources.get(s.pages[0].sourceId)!.name, "edited");
    const bytes = await buildOutputBytes(s.pages);
    report(await sharePdf(bytes, name), name);
  } catch (err) {
    s.setError(`Couldn't share: ${(err as Error).message}`);
  } finally {
    useShareStore.setState({ busy: false });
  }
}
