import { createSseParser } from "./sse";
import type { Plan } from "../account/capabilities";
import { getOwnerKey } from "./owner";

export interface AiRequest {
  task: "summarize" | "ask" | "rewrite" | "extract";
  document: { page: number; text: string }[];
  question?: string;
  history?: { role: "user" | "assistant"; text: string }[];
  selection?: string;
  mode?: string;
  language?: string;
  retrieved?: boolean;
}
export interface DoneData { usage: { input: number; output: number }; stop: string; remaining: { requests: number; tokens: number } | null; resetAt?: number; unlimited?: boolean }
export interface Handlers { onDelta(text: string): void; onDone(d: DoneData): void; onError(code: string, extra?: Record<string, unknown>): void }

export interface OcrResponse { pages: { page: number; lines: string[] }[]; failed: number[]; remaining: { requests: number; tokens: number } | null; resetAt?: number; unlimited?: boolean }

export interface MeResponse {
  plan: Plan;
  paywall: boolean;
  trialEndsAt?: number;
  periodEnd?: number | null;
  status?: string | null;
  termsAccepted?: boolean;
  termsVersion?: string;
  usage?: { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number };
  limits?: { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number; edit: boolean } | null;
  /** Present (true) only for an owner session: every limit and gate is lifted. */
  owner?: boolean;
}

/** Session failures surface as one of these codes; anything else (Turnstile errors, network) is "verification_failed". */
const SESSION_ERRORS = new Set(["signin_required", "account_unavailable"]);
const sessionError = (e: unknown): string => (e instanceof Error && SESSION_ERRORS.has(e.message) ? e.message : "verification_failed");

export class AiClient {
  private token: string | null = null;
  /** True once /session reported an owner session (unlimited use). */
  isOwner = false;
  private pending: Promise<string> | null = null;
  private baseUrl: string;
  private getTurnstileToken: () => Promise<string>;
  private getAuthToken?: () => Promise<string | null>;
  private isSignedIn: () => boolean;
  private fetchFn: typeof fetch;
  private onSession?: (info: { owner: boolean }) => void;
  // Bumped by resetSession(); a session fetch from an older generation must not become the cached token.
  private generation = 0;

  constructor(opts: { baseUrl: string; getTurnstileToken: () => Promise<string>; getAuthToken?: () => Promise<string | null>; isSignedIn?: () => boolean; fetchFn?: typeof fetch; onSession?: (info: { owner: boolean }) => void }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.getTurnstileToken = opts.getTurnstileToken;
    this.getAuthToken = opts.getAuthToken;
    this.isSignedIn = opts.isSignedIn ?? (() => false);
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.onSession = opts.onSession;
  }

  ensureSession(force = false): Promise<string> {
    if (this.token && !force) return Promise.resolve(this.token);
    if (!this.pending) {
      const p: Promise<string> = this.fetchSession().finally(() => { if (this.pending === p) this.pending = null; });
      this.pending = p;
    }
    return this.pending;
  }

  private async fetchSession(): Promise<string> {
    const gen = this.generation;
    const signedIn = this.isSignedIn();
    const jwt = this.getAuthToken ? await this.getAuthToken().catch(() => null) : null;
    // Signed in but no Clerk token: never mint an anonymous session in the user's place.
    if (!jwt && signedIn) throw new Error("verification_failed");
    const ownerKey = getOwnerKey();
    const owner = ownerKey ? { ownerKey } : {};
    const res = jwt
      ? await this.fetchFn(`${this.baseUrl}/session`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(owner) })
      : await this.fetchFn(`${this.baseUrl}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken: await this.getTurnstileToken(), ...owner }) });
    if (!res.ok) throw new Error(res.status === 503 ? "account_unavailable" : jwt && res.status === 401 ? "signin_required" : "verification_failed");
    const body = (await res.json()) as { token: string; owner?: boolean };
    if (gen === this.generation) this.token = body.token;
    // The owner bit depends only on the stored owner key, so even a superseded session's answer is current.
    this.isOwner = body.owner === true;
    this.onSession?.({ owner: this.isOwner });
    return body.token;
  }

  /** Drop the cached session (and any in-flight fetch) so the next request re-authenticates (call on sign-in, sign-out and plan change). */
  resetSession(): void { this.token = null; this.pending = null; this.generation++; }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    let token = await this.ensureSession();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (res.status === 401 && attempt === 0) { token = await this.ensureSession(true); continue; }
      if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "upstream"); }
      return (await res.json()) as T;
    }
    throw new Error("upstream");
  }
  me() { return this.post<MeResponse>("/me"); }
  async acceptTerms(version: string) { await this.post("/terms/accept", { version }); }
  async checkout(interval: "month" | "year") { return (await this.post<{ url: string }>("/billing/checkout", { interval })).url; }
  async portal() { return (await this.post<{ url: string }>("/billing/portal")).url; }
  async deleteAccount() { await this.post("/account/delete"); }

  async runOcr(pages: { page: number; image: string }[], signal?: AbortSignal): Promise<OcrResponse> {
    let token: string;
    try { token = await this.ensureSession(); } catch (e) { throw new Error(sessionError(e)); }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/ocr`, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ task: "ocr", pages }) });
      } catch (err) { throw new Error((err as Error).name === "AbortError" ? "cancelled" : "network"); }
      if (res.status === 401 && attempt === 0) { try { token = await this.ensureSession(true); continue; } catch (e) { throw new Error(sessionError(e)); } }
      if (!res.ok) { const err = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: number }; throw Object.assign(new Error(err.error ?? "upstream"), { resetAt: err.resetAt }); }
      return (await res.json()) as OcrResponse;
    }
    throw new Error("upstream");
  }

  async createLiveSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number | null; resetAt?: number; maxSeconds?: number; unlimited?: boolean }> {
    let token: string;
    try { token = await this.ensureSession(); } catch (e) { throw new Error(sessionError(e)); }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try { res = await this.fetchFn(`${this.baseUrl}/live`, { method: "POST", headers: { authorization: `Bearer ${token}` } }); } catch { throw new Error("network"); }
      if (res.status === 401 && attempt === 0) { try { token = await this.ensureSession(true); continue; } catch (e) { throw new Error(sessionError(e)); } }
      if (!res.ok) { const err = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: number; remainingSeconds?: number; sessionSeconds?: number; scope?: "day" | "month" }; throw Object.assign(new Error(err.error ?? "upstream"), { resetAt: err.resetAt, remainingSeconds: err.remainingSeconds, sessionSeconds: err.sessionSeconds, scope: err.scope }); }
      return (await res.json()) as { conversationId: string; token: string; remainingSeconds: number | null; resetAt?: number; maxSeconds?: number; unlimited?: boolean };
    }
    throw new Error("upstream");
  }

  /** Best effort: never throws. keepalive lets the report survive page unload. */
  async reportLiveUsage(conversationId: string, seconds: number, keepalive = false): Promise<{ remainingSeconds: number | null; unlimited?: boolean } | null> {
    try {
      const token = await this.ensureSession();
      const res = await this.fetchFn(`${this.baseUrl}/live/usage`, { method: "POST", keepalive, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ conversationId, seconds: Math.max(0, Math.min(600, Math.round(seconds))) }) });
      if (!res.ok) return null;
      return (await res.json()) as { remainingSeconds: number | null; unlimited?: boolean };
    } catch { return null; }
  }

  runTask(body: AiRequest, handlers: Handlers): { abort(): void; done: Promise<void> } {
    const controller = new AbortController();
    const done = (async () => {
      let token: string;
      try { token = await this.ensureSession(); } catch (e) { handlers.onError(sessionError(e)); return; }
      for (let attempt = 0; attempt < 2; attempt++) {
        let res: Response;
        try {
          res = await this.fetchFn(`${this.baseUrl}/ai`, {
            method: "POST", signal: controller.signal,
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
          });
        } catch (err) {
          handlers.onError((err as Error).name === "AbortError" ? "interrupted" : "network");
          return;
        }
        if (res.status === 401 && attempt === 0) {
          try { token = await this.ensureSession(true); continue; } catch (e) { handlers.onError(sessionError(e)); return; }
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: number; maxChars?: number };
          const extra: Record<string, unknown> = {};
          if (err.resetAt) extra.resetAt = err.resetAt;
          if (err.maxChars) extra.maxChars = err.maxChars;
          handlers.onError(err.error ?? "upstream", Object.keys(extra).length ? extra : undefined);
          return;
        }
        let finished = false;
        let bad = false;
        const reader = res.body!.getReader();
        const parser = createSseParser((e) => {
          if (finished || bad) return;
          let data: any;
          try { data = JSON.parse(e.data); } catch {
            bad = true; finished = true;
            void reader.cancel().catch(() => {});
            handlers.onError("upstream");
            return;
          }
          if (e.event === "delta") handlers.onDelta(data.text);
          else if (e.event === "done") { finished = true; handlers.onDone(data); }
          else if (e.event === "error") { finished = true; handlers.onError(data.error); }
        });
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { value, done: d } = await reader.read();
            if (d || bad) break;
            parser.push(decoder.decode(value, { stream: true }));
          }
          parser.end();
        } catch (err) {
          if (!finished) handlers.onError((err as Error).name === "AbortError" ? "interrupted" : "network");
          return;
        }
        if (!finished) handlers.onError("interrupted", undefined);
        return;
      }
    })();
    return { abort: () => controller.abort(), done };
  }
}
