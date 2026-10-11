export default function RewriteTab({ disabled }: { disabled: boolean }) {
  return <div className="ai-tab"><p className="muted">Select text on a page to rewrite it.</p><button data-testid="ai-run" className="primary" disabled>Run</button>{disabled && null}</div>;
}
