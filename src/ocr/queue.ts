// src/ocr/queue.ts
import { isEmptyOcr } from "./layout";
import type { OcrEngineName, OcrPage } from "./types";

export type OcrJobState = "queued" | "running" | "done" | "empty" | "failed";
export interface OcrJob { sourceId: string; pageIndex: number; engine: OcrEngineName }
/** `cause` is the original thrown value of a failed run (e.g. a quota error carrying `resetAt`). */
export interface OcrStateExtra { page?: OcrPage; error?: string; cause?: unknown }
export interface OcrQueueEvents { onState(job: OcrJob, state: OcrJobState, extra?: OcrStateExtra): void }
export const OCR_TIMEOUT_MS = 60_000;

interface Entry { job: OcrJob; controller: AbortController; running: boolean; cancelled: boolean; timedOut: boolean; timer?: ReturnType<typeof setTimeout> }
const keyOf = (j: OcrJob) => `${j.sourceId}:${j.pageIndex}:${j.engine}`;

export function createOcrQueue(run: (job: OcrJob, signal: AbortSignal) => Promise<OcrPage>, events: OcrQueueEvents, opts: { timeoutMs?: number; isEmpty?: (p: OcrPage) => boolean } = {}) {
  const timeoutMs = opts.timeoutMs ?? OCR_TIMEOUT_MS;
  const isEmpty = opts.isEmpty ?? isEmptyOcr;
  const lanes = new Map<OcrEngineName, Entry[]>();
  const keys = new Set<string>();

  const remove = (engine: OcrEngineName, e: Entry) => {
    const l = lanes.get(engine);
    const i = l ? l.indexOf(e) : -1;
    if (l && i >= 0) l.splice(i, 1);
    keys.delete(keyOf(e.job));
  };

  const pump = (engine: OcrEngineName) => {
    const lane = lanes.get(engine) ?? [];
    const head = lane[0];
    if (!head || head.running) return;
    head.running = true;
    events.onState(head.job, "running");
    const signal = head.controller.signal;
    // Rejects on abort so a run that ignores the signal cannot wedge the lane or defeat the timeout.
    const aborted = new Promise<never>((_, rej) => {
      signal.addEventListener("abort", () => rej(signal.reason), { once: true });
    });
    head.timer = setTimeout(() => { head.timedOut = true; head.controller.abort(new Error("timeout")); }, timeoutMs);
    let attempt: Promise<OcrPage>;
    try { attempt = run(head.job, signal); } catch (err) { attempt = Promise.reject(err); }
    const finish = (state: OcrJobState, extra?: OcrStateExtra) => {
      clearTimeout(head.timer);
      if (head.cancelled) return; // cancelSource already removed it and advanced the lane
      remove(engine, head); // before emitting, so a handler may re-enqueue the same job
      try { events.onState(head.job, state, extra); } finally { pump(engine); }
    };
    Promise.race([attempt, aborted]).then(
      (page) => finish(isEmpty(page) ? "empty" : "done", { page }),
      (err) => finish("failed", { error: head.timedOut ? "timeout" : err instanceof Error ? err.message : String(err), cause: err }),
    );
  };

  return {
    enqueue(job: OcrJob) {
      const k = keyOf(job);
      if (keys.has(k)) return;
      keys.add(k);
      const lane = lanes.get(job.engine) ?? [];
      lanes.set(job.engine, lane);
      lane.push({ job, controller: new AbortController(), running: false, cancelled: false, timedOut: false });
      events.onState(job, "queued");
      queueMicrotask(() => pump(job.engine));
    },
    cancelSource(sourceId: string) {
      for (const [engine, lane] of lanes) {
        for (const e of [...lane]) {
          if (e.job.sourceId !== sourceId) continue;
          if (e.running) {
            e.cancelled = true;
            clearTimeout(e.timer);
            e.controller.abort(new Error("cancelled"));
          }
          remove(engine, e);
        }
        pump(engine);
      }
    },
    /** Drops queued jobs and aborts the running one of a single engine lane. Emits no state, like cancelSource. */
    cancelLane(engine: OcrEngineName) {
      const lane = lanes.get(engine);
      if (!lane) return;
      for (const e of [...lane]) {
        if (e.running) {
          e.cancelled = true;
          clearTimeout(e.timer);
          e.controller.abort(new Error("cancelled"));
        }
        remove(engine, e);
      }
    },
    cancelAll() { for (const lane of lanes.values()) for (const e of [...lane]) this.cancelSource(e.job.sourceId); },
    get pending() { let n = 0; for (const lane of lanes.values()) n += lane.length; return n; },
  };
}
