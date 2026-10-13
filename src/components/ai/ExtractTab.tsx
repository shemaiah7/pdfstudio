import { useAiStore } from "../../store/ai";
import { useGate, useLocked } from "../account/useGate";
import PageLink from "./PageLink";

function toCsv(rows: { label: string; value: string; page: number }[]) {
  const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  return ["label,value,page", ...rows.map((r) => [r.label, r.value, r.page].map(esc).join(","))].join("\n");
}

export default function ExtractTab({ disabled }: { disabled: boolean }) {
  const { extract, run } = useAiStore();
  const { require } = useGate();
  const locked = useLocked("ai");
  return (
    <div className="ai-tab">
      <button data-testid="ai-run" className={`primary${locked ? " locked" : ""}`} disabled={disabled || extract.status === "running"} onClick={() => { if (require("ai")) void run("extract"); }}>
        {extract.status === "running" ? "Extracting…" : "Extract key facts"}
      </button>
      {extract.error && <div className="ai-error">{extract.error}</div>}
      {extract.facts.length > 0 && (
        <div data-testid="ai-result" className="ai-result">
          <table className="facts"><thead><tr><th>Label</th><th>Value</th><th>Page</th></tr></thead>
            <tbody>{extract.facts.map((f, i) => <tr key={i}><td>{f.label}</td><td>{f.value}</td><td><PageLink page={f.page} /></td></tr>)}</tbody></table>
          <button onClick={() => navigator.clipboard.writeText(toCsv(extract.facts))}>Copy as CSV</button>
        </div>
      )}
      {extract.status === "done" && extract.facts.length === 0 && !extract.error && <p className="muted">No key facts found.</p>}
    </div>
  );
}
