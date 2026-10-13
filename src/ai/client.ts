import { createSseParser } from "./sse";
import type { Plan } from "../account/capabilities";

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
export interface DoneData { usage: { input: number; output: number }; stop: string; remaining: { requests: number; tokens: number }; resetAt: number }
export interface Handlers { onDelta(text: string): void; onDone(d: DoneData): void; onError(code: string, extra?: Record<string, unknown>): void }

export interface OcrResponse { pages: { page: number; lines: string[] }[]; failed: number[]; remaining: { requests: number; tokens: number }; resetAt: number }

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
}

export class AiClient {
  private token: string | null = null;
  private pending: Promise<string> | null = null;
  private baseUrl: string;
  private getTurnstileToken: () => Promise<string>;
  private getAuthToken?: () => Promise<string | null>;
  private fetchFn: typeof fetch;

  constructor(opts: { baseUrl: string; getTurnstileToken: () => Promise<string>; getAuthToken?: () => Promise<string | null>; fetchFn?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.getTurnstileToken = opts.getTurnstileToken;
    this.getAuthToken = opts.getAuthToken;
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  }

  ensureSession(force = false): Promise<string> {
    if (this.token && !force) return Promise.resolve(this.token);
    if (!this.pending) {
      this.pending = this.fetchSession().finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  private async fetchSession(): Promise<string> {
    const jwt = this.getAuthToken ? await this.getAuthToken().catch(() => null) : null;
    const res = jwt
      ? await this.fetchFn(`${this.baseUrl}/session`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } })
      : await this.fetchFn(`${this.baseUrl}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken: await this.getTurnstileToken() }) });
    if (!res.ok) throw new Error(res.status === 503 ? "account_unavailable" : "verification_failed");
    const body = (await res.json()) as { token: string };
    this.token = body.token;
    return this.token;
  }

  /** Drop the cached session so the next request re-authenticates (call on sign-in and sign-out). */
  resetSession(): void { this.token = null; }

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
    try { token = await this.ensureSession(); } catch { throw new Error("verification_failed"); }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/ocr`, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ task: "ocr", pages }) });
      } catch (err) { throw new Error((err as Error).name === "AbortError" ? "cancelled" : "network"); }
      if (res.status === 401 && attempt === 0) { try { token = await this.ensureSession(true); continue; } catch { throw new Error("verification_failed"); } }
      if (!res.ok) { const err = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: number }; throw Object.assign(new Error(err.error ?? "upstream"), { resetAt: err.resetAt }); }
      return (await res.json()) as OcrResponse;
    }
    throw new Error("upstream");
  }

  async createLiveSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number; resetAt: number; maxSeconds?: number }> {
    let token: string;
    try { token = await this.ensureSession(); } catch { throw new Error("verification_failed"); }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try { res = await this.fetchFn(`${this.baseUrl}/live`, { method: "POST", headers: { authorization: `Bearer ${token}` } }); } catch { throw new Error("network"); }
      if (res.status === 401 && attempt === 0) { try { token = await this.ensureSession(true); continue; } catch { throw new Error("verification_failed"); } }
      if (!res.ok) { const err = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: number; remainingSeconds?: number; sessionSeconds?: number }; throw Object.assign(new Error(err.error ?? "upstream"), { resetAt: err.resetAt, remainingSeconds: err.remainingSeconds, sessionSeconds: err.sessionSeconds }); }
      return (await res.json()) as { conversationId: string; token: string; remainingSeconds: number; resetAt: number; maxSeconds?: number };
    }
    throw new Error("upstream");
  }

  /** Best effort: never throws. keepalive lets the report survive page unload. */
  async reportLiveUsage(conversationId: string, seconds: number, keepalive = false): Promise<{ remainingSeconds: number } | null> {
    try {
      const token = await this.ensureSession();
      const res = await this.fetchFn(`${this.baseUrl}/live/usage`, { method: "POST", keepalive, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ conversationId, seconds: Math.max(0, Math.min(600, Math.round(seconds))) }) });
      if (!res.ok) return null;
      return (await res.json()) as { remainingSeconds: number };
    } catch { return null; }
  }

  runTask(body: AiRequest, handlers: Handlers): { abort(): void; done: Promise<void> } {
    const controller = new AbortController();
    const done = (async () => {
      let token: string;
      try { token = await this.ensureSession(); } catch { handlers.onError("verification_failed"); return; }
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
          try { token = await this.ensureSession(true); continue; } catch { handlers.onError("verification_failed"); return; }
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
