import { useEffect, useRef, useState } from "react";
import { useToolsStore } from "../store/tools";
import { canRemember, forgetSignature, loadSignature, saveSignature } from "../signature/storage";
import { scaledSize, trimToPng, whiteToTransparent } from "../signature/image";

interface Props { onConfirm(png: string): void; onClose(): void }
type Tab = "draw" | "type" | "upload";

const FONTS = [
  { label: "Brush", css: '"Brush Script MT", "Snell Roundhand", cursive', cls: "sigFont0" },
  { label: "Chancery", css: '"Apple Chancery", "URW Chancery L", cursive', cls: "sigFont1" },
  { label: "Casual", css: '"Savoye LET", "Lucida Handwriting", cursive', cls: "sigFont2" },
];
const MAX_UPLOAD = 2 * 1024 * 1024;

export default function SignatureDialog({ onConfirm, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("draw");
  const [name, setName] = useState("");
  const [font, setFont] = useState(0);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<string | null>(() => loadSignature());
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<File | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const rememberable = canRemember();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const finish = (png: string) => {
    if (remember && rememberable && !saveSignature(png)) useToolsStore.getState().setMessage("Couldn't remember the signature in this browser");
    onConfirm(png);
  };
  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / (r.width || c.width)), y: (e.clientY - r.top) * (c.height / (r.height || c.height)) };
  };
  const down = (e: React.PointerEvent) => {
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
    drawing.current = true; setDrawn(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = pos(e);
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y); ctx.stroke();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); setDrawn(false); };

  const confirm = async () => {
    setError(null);
    try {
      if (tab === "draw") {
        if (!drawn || !canvasRef.current) { setError("Draw your signature first."); return; }
        finish(trimToPng(canvasRef.current));
      } else if (tab === "type") {
        const text = name.trim();
        if (!text) { setError("Type your name first."); return; }
        const family = FONTS[font].css, spec = `48px ${family}`;
        try { await document.fonts.load(spec, text); } catch { /* fall back to whatever is available */ }
        const c = document.createElement("canvas"); c.width = 600; c.height = 150;
        const ctx = c.getContext("2d"); if (!ctx) { setError("Canvas is unavailable."); return; }
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.font = spec; ctx.fillStyle = "#000"; ctx.textBaseline = "middle";
        const w = ctx.measureText(text).width;
        ctx.fillText(text, Math.max(0, (c.width - w) / 2), c.height / 2);
        finish(trimToPng(c));
      } else {
        if (!upload) { setError("Choose a PNG or JPG file."); return; }
        finish(await fromFile(upload));
      }
    } catch { setError("Could not create the signature."); }
  };

  const pickFile = (f: File | undefined) => {
    setError(null); setUpload(null);
    if (!f) return;
    if (f.type !== "image/png" && f.type !== "image/jpeg") { setError("Only PNG or JPG images are allowed."); return; }
    if (f.size > MAX_UPLOAD) { setError("Image is larger than 2 MB."); return; }
    setUpload(f);
  };

  return (
    <div className="sigBackdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sigDialog" role="dialog" aria-label="Signature">
        <div className="sigTabs">
          {(["draw", "type", "upload"] as Tab[]).map((t) => (
            <button key={t} data-testid={`sig-tab-${t}`} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setError(null); }}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        {tab === "draw" ? (
          <div>
            <canvas ref={canvasRef} className="sigCanvas" width={400} height={150} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            <div><button onClick={clear}>Clear</button></div>
          </div>
        ) : null}
        {tab === "type" ? (
          <div>
            <input data-testid="sig-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="sigFonts">
              {FONTS.map((f, i) => (
                <button key={f.cls} data-testid={`sig-font-${i}`} className={`${f.cls}${font === i ? " active" : ""}`} onClick={() => setFont(i)}>{name.trim() || f.label}</button>
              ))}
            </div>
          </div>
        ) : null}
        {tab === "upload" ? (
          <div><input type="file" accept="image/png,image/jpeg" onChange={(e) => pickFile(e.target.files?.[0])} /></div>
        ) : null}
        {error ? <div className="sigError" data-testid="sig-error" role="alert">{error}</div> : null}
        {rememberable ? <label className="sigRemember"><input type="checkbox" data-testid="sig-remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this signature</label> : null}
        <div className="sigActions">
          {saved ? <>
            <button data-testid="sig-use-saved" onClick={() => onConfirm(saved)}>Use saved</button>
            <button data-testid="sig-forget" onClick={() => { forgetSignature(); setSaved(null); }}>Forget</button>
          </> : null}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button data-testid="sig-confirm" className="primary" onClick={confirm}>Add signature</button>
        </div>
      </div>
    </div>
  );
}

function fromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const { width: w, height: h } = scaledSize(img.naturalWidth, img.naturalHeight);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); if (!ctx) throw new Error("no canvas");
        ctx.drawImage(img, 0, 0, w, h);
        ctx.putImageData(whiteToTransparent(ctx.getImageData(0, 0, c.width, c.height)), 0, 0);
        resolve(trimToPng(c));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}
