import { useState } from "react";
import { markPromptDone, promptDone, useDefaultApp } from "../pwa/defaultApp";
import DefaultAppDialog from "./DefaultAppDialog";

export default function DefaultAppPrompt() {
  const { os, installed } = useDefaultApp();
  const [hidden, setHidden] = useState(promptDone);
  const [open, setOpen] = useState(false);
  if (!installed || !os) return null;
  return (
    <>
      {hidden ? null : (
        <div className="default-prompt" role="status" data-testid="default-app-prompt">
          <span>Make PDF Studio your default PDF app?</span>
          <button type="button" className="default-prompt-btn" data-testid="default-app-show"
            onClick={() => { markPromptDone(); setHidden(true); setOpen(true); }}>Show me how</button>
          <button type="button" className="default-prompt-btn ghost" data-testid="default-app-dismiss"
            onClick={() => { markPromptDone(); setHidden(true); }}>Not now</button>
        </div>
      )}
      {open ? <DefaultAppDialog os={os} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
