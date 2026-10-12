import { useEffect } from "react";
import { useAiStore } from "../../store/ai";
import { useDocumentStore } from "../../store/document";

export default function ScopeToggle() {
  const scope = useAiStore((s) => s.scope);
  const setScope = useAiStore((s) => s.setScope);
  const hasSelection = useDocumentStore((s) => s.selection.size > 0);
  // With no pages selected, "Selected pages" has nothing to send: fall back to the whole document.
  useEffect(() => { if (!hasSelection && scope === "selected") setScope("all"); }, [hasSelection, scope, setScope]);
  return (
    <div className="ai-row scope-toggle" data-testid="ai-scope">
      <label className={scope === "all" ? "checked" : ""}><input type="radio" className="sr-only" checked={scope === "all"} onChange={() => setScope("all")} /> Whole document</label>
      <label className={`${scope === "selected" ? "checked" : ""} ${hasSelection ? "" : "disabled"}`}><input type="radio" className="sr-only" checked={scope === "selected"} disabled={!hasSelection} onChange={() => setScope("selected")} /> Selected pages</label>
    </div>
  );
}
