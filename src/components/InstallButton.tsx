import { useEffect, useState } from "react";
import { useInstallStore } from "../pwa/install";
import { isDesktop } from "../desktop/bridge";
import { Icon } from "./icons";

const HELP = {
  ios: "Tap the Share button, then Add to Home Screen.",
  "safari-mac": "In the menu bar choose File → Add to Dock.",
} as const;

interface Props { className?: string; label?: boolean; iconOnly?: boolean }

export default function InstallButton({ className, label = true, iconOnly = false }: Props) {
  const installed = useInstallStore((s) => s.installed);
  const hint = useInstallStore((s) => s.platformHint);
  const install = useInstallStore((s) => s.install);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (isDesktop() || installed || hint === "none") return null;
  const onClick = () => { if (hint === "prompt") void install(); else setOpen(true); };
  return (
    <>
      <button type="button" className={className} data-testid="install-app" aria-label="Install app" title="Install app" onClick={onClick}>
        <Icon name="install" size={iconOnly ? 18 : 16} />{label && !iconOnly ? <span className="install-label">Install app</span> : null}
      </button>
      {open && hint !== "prompt" ? (
        <div className="sigBackdrop" data-testid="install-dialog-scrim" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sigDialog installDialog" role="dialog" aria-label="Install SentinelPDF">
            <div className="sigHeader">
              <h2>Install SentinelPDF</h2>
              <button type="button" className="sigClose" aria-label="Close" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <div className="sigBody"><p className="installHelp">{HELP[hint]}</p></div>
            <div className="sigActions"><button type="button" className="sigPrimary" onClick={() => setOpen(false)}>Got it</button></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
