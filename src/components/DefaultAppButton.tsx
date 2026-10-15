import { useState } from "react";
import { markPromptDone, useDefaultApp } from "../pwa/defaultApp";
import { isDesktop } from "../desktop/bridge";
import DefaultAppDialog from "./DefaultAppDialog";
import { Icon } from "./icons";

export default function DefaultAppButton({ className }: { className?: string }) {
  const { os, installed } = useDefaultApp();
  const [open, setOpen] = useState(false);
  if (isDesktop() || !installed || !os) return null;
  return (
    <>
      <button type="button" className={className} data-testid="default-app" aria-label="Make default PDF app" title="Make default PDF app"
        onClick={() => { markPromptDone(); setOpen(true); }}>
        <Icon name="file" size={16} /><span className="install-label">Make default PDF app</span>
      </button>
      {open ? <DefaultAppDialog os={os} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
