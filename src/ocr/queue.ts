// src/ocr/queue.ts
import { isEmptyOcr } from "./layout";
import type { OcrEngineName, OcrPage } from "./types";

export type OcrJobState = "queued" | "running" | "done" | "empty" | "failed";
export interface OcrJob { sourceId: string; pageIndex: number; engine: OcrEngineName }
export interface OcrQueueEvents { onState(job: OcrJob, state: OcrJobState, extra?: { page?: OcrPage; error?: string }): void }
export const OCR_TIMEOUT_MS = 60_000;

interface Entry { job: OcrJob; controller: AbortController; running: boolean }
const keyOf = (j: OcrJob) => `${j.sourceId}:${j.pageIndex}:${j.engine}`;

export function createOcrQueue(run: (job: OcrJob, signal: AbortSignal) => Promise<OcrPage>, events: OcrQueueEvents, opts: { timeoutMs?: number; isEmpty?: (p: OcrPage) => boolean } = {}) {
  const timeoutMs = opts.timeoutMs ?? OCR_TIMEOUT_MS;
  const isEmpty = opts.isEmpty ?? isEmptyOcr;
  const lanes = new Map<OcrEngineName, Entry[]>();
  const keys = new Set<string>();

  const pump = (engine: OcrEngineName) => {
    const lane = lanes.get(engine) ?? [];
    const head = lane[0];
    if (!head || head.running) return;
    head.running = true;
    events.onState(head.job, "running");
    const timer = setTimeout(() => head.controller.abort(new Error("timeout")), timeoutMs);
    run(head.job, head.controller.signal).then(
      (page) => { if (!head.controller.signal.aborted) events.onState(head.job, isEmpty(page) ? "empty" : "done", { page }); },
      (err) => {
        const reason = head.controller.signal.reason;
        if (head.controller.signal.aborted && !(reason instanceof Error && reason.message === "timeout")) return; // cancelled: no state
        events.onState(head.job, "failed", { error: reason instanceof Error && reason.message === "timeout" ? "timeout" : err instanceof Error ? err.message : String(err) });
      },
    ).finally(() => {
      clearTimeout(timer);
      const l = lanes.get(engine) ?? [];
      if (l[0] === head) l.shift();
      keys.delete(keyOf(head.job));
      pump(engine);
    });
  };

  return {
    enqueue(job: OcrJob) {
      const k = keyOf(job);
      if (keys.has(k)) return;
      keys.add(k);
      const lane = lanes.get(job.engine) ?? [];
      lanes.set(job.engine, lane);
      lane.push({ job, controller: new AbortController(), running: false });
      events.onState(job, "queued");
      queueMicrotask(() => pump(job.engine));
    },
    cancelSource(sourceId: string) {
      for (const [engine, lane] of lanes) {
        for (const e of [...lane]) {
          if (e.job.sourceId !== sourceId) continue;
          if (e.running) e.controller.abort(new Error("cancelled"));
          else { lane.splice(lane.indexOf(e), 1); keys.delete(keyOf(e.job)); }
        }
        pump(engine);
      }
    },
    cancelAll() { for (const lane of lanes.values()) for (const e of [...lane]) this.cancelSource(e.job.sourceId); },
    get pending() { let n = 0; for (const lane of lanes.values()) n += lane.length; return n; },
  };
}
