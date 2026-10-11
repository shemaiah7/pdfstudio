declare global {
  interface Window { turnstile?: { render(el: string | HTMLElement, opts: Record<string, unknown>): string; remove(id: string): void } }
}

export function getTurnstileToken(siteKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("div");
    el.style.position = "fixed"; el.style.bottom = "8px"; el.style.right = "8px"; el.style.zIndex = "1000";
    document.body.appendChild(el);
    const cleanup = (id?: string) => { try { if (id) window.turnstile?.remove(id); } catch { /* ignore */ } el.remove(); };
    const start = () => {
      if (!window.turnstile) { cleanup(); return reject(new Error("turnstile_unavailable")); }
      let id: string | undefined;
      try {
        id = window.turnstile.render(el, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (token: string) => { cleanup(id); resolve(token); },
          "error-callback": () => { cleanup(id); reject(new Error("turnstile_error")); },
          "timeout-callback": () => { cleanup(id); reject(new Error("turnstile_timeout")); },
        });
      } catch (err) {
        cleanup(id); reject(err);
      }
    };
    if (window.turnstile) start();
    else {
      const timeout = setTimeout(() => { clearInterval(t); if (!window.turnstile) { cleanup(); reject(new Error("turnstile_unavailable")); } }, 10_000);
      const t = setInterval(() => { if (window.turnstile) { clearInterval(t); clearTimeout(timeout); start(); } }, 100);
    }
  });
}
