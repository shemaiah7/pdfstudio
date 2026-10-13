import { useEffect } from "react";
import { useAiStore } from "../../store/ai";
import { AiClient } from "../../ai/client";
import { getTurnstileToken } from "../../ai/turnstile";
import { getAuthToken, isSignedIn } from "../../account/authState";
import { getOwnerKey } from "../../ai/owner";

/** Creates the shared AI client once (idempotent) and returns whether AI is configured. */
export function useAiClient(): boolean {
  const client = useAiStore((s) => s.client);
  const setClient = useAiStore((s) => s.setClient);

  // Localhost / Turnstile test-key fallbacks are for development only; production must be configured.
  const baseUrl = import.meta.env.VITE_AI_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? "1x00000000000000000000AA" : "");
  const configured = !!baseUrl && !!siteKey;

  useEffect(() => {
    if (client || !configured) return;
    const c = new AiClient({ baseUrl, getTurnstileToken: () => getTurnstileToken(siteKey), getAuthToken, isSignedIn, onSession: ({ owner }) => useAiStore.setState({ owner }) });
    setClient(c);
    // With an owner key stored, mint a session now so the owner flag is known before the first gated click.
    if (getOwnerKey()) void c.ensureSession().catch(() => {});
  }, [client, setClient, configured, baseUrl, siteKey]);

  return configured;
}
