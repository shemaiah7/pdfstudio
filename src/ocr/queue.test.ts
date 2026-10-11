import { describe, it, expect, vi } from "vitest";
import { createOcrQueue, type OcrJob, type OcrJobState } from "./queue";
import { linesToOcrPage } from "./layout";

const page = (t: string) => linesToOcrPage([t], { widthPt: 100, heightPt: 100 });
const job = (p: number, engine: "tesseract" | "claude" = "tesseract", sourceId = "s1"): OcrJob => ({ sourceId, pageIndex: p, engine });
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createOcrQueue", () => {
  it("runs one job at a time per engine lane, in order, emitting states", async () => {
    const d1 = deferred<ReturnType<typeof page>>(), d2 = deferred<ReturnType<typeof page>>();
    const started: number[] = [];
    const states: [number, OcrJobState][] = [];
    const q = createOcrQueue((j) => { started.push(j.pageIndex); return j.pageIndex === 0 ? d1.promise : d2.promise; }, { onState: (j, s) => states.push([j.pageIndex, s]) });
    q.enqueue(job(0)); q.enqueue(job(1));
    await tick();
    expect(started).toEqual([0]);
    expect(q.pending).toBe(2);
    d1.resolve(page("a")); await tick(); await tick();
    expect(started).toEqual([0, 1]);
    d2.resolve(page("b")); await tick(); await tick();
    expect(states).toEqual([[0, "queued"], [1, "queued"], [0, "running"], [0, "done"], [1, "running"], [1, "done"]]);
    expect(q.pending).toBe(0);
  });
  it("runs tesseract and claude lanes concurrently", async () => {
    const d = deferred<ReturnType<typeof page>>();
    const started: string[] = [];
    const q = createOcrQueue((j) => { started.push(j.engine); return d.promise; }, { onState: () => {} });
    q.enqueue(job(0, "tesseract")); q.enqueue(job(0, "claude"));
    await tick();
    expect(started).toEqual(["tesseract", "claude"]);
    d.resolve(page("x"));
  });
  it("marks empty results, failures, and times out", async () => {
    vi.useFakeTimers();
    const states: [number, OcrJobState, string | undefined][] = [];
    const q = createOcrQueue(async (j, signal) => {
      if (j.pageIndex === 0) return { ...page("x"), confidence: 0.1 };
      if (j.pageIndex === 1) throw new Error("boom");
      return new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("cancelled"))));
    }, { onState: (j, s, e) => states.push([j.pageIndex, s, e?.error]) }, { timeoutMs: 1000 });
    q.enqueue(job(0)); q.enqueue(job(1)); q.enqueue(job(2));
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    expect(states.filter(([, s]) => s !== "queued" && s !== "running")).toEqual([[0, "empty", undefined], [1, "failed", "boom"], [2, "failed", "timeout"]]);
  });
  it("cancelLane drops and aborts only that engine's jobs, emits no state, and passes the failure cause", async () => {
    const aborted: string[] = [];
    const states: [string, number, OcrJobState][] = [];
    const q = createOcrQueue((j, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => { aborted.push(`${j.engine}${j.pageIndex}`); rej(new Error("cancelled")); })), { onState: (j, s) => states.push([j.engine, j.pageIndex, s]) });
    q.enqueue(job(0, "claude")); q.enqueue(job(1, "claude")); q.enqueue(job(0, "tesseract"));
    await tick();
    const before = states.length;
    q.cancelLane("claude");
    await tick(); await tick();
    expect(aborted).toEqual(["claude0"]);
    expect(states.length).toBe(before);
    expect(q.pending).toBe(1);
    q.enqueue(job(0, "claude")); // slot is free again
    expect(q.pending).toBe(2);
    q.cancelAll();
  });
  it("hands the original error to onState as cause", async () => {
    const err = Object.assign(new Error("daily_limit"), { resetAt: 42 });
    const causes: unknown[] = [];
    const q = createOcrQueue(async () => { throw err; }, { onState: (_j, s, e) => { if (s === "failed") causes.push(e?.cause); } });
    q.enqueue(job(0)); await tick(); await tick();
    expect(causes).toEqual([err]);
  });
  it("cancelSource drops queued jobs for that source and aborts the running one", async () => {
    const aborted: number[] = [];
    const states: [string, number, OcrJobState][] = [];
    const q = createOcrQueue((j, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => { aborted.push(j.pageIndex); rej(new Error("cancelled")); })), { onState: (j, s) => states.push([j.sourceId, j.pageIndex, s]) });
    q.enqueue(job(0)); q.enqueue(job(1)); q.enqueue(job(0, "tesseract", "s2"));
    await tick();
    q.cancelSource("s1");
    await tick(); await tick();
    expect(aborted).toEqual([0]);
    expect(states.some(([src, , s]) => src === "s1" && (s === "done" || s === "failed"))).toBe(false);
    expect(states).toContainEqual(["s2", 0, "running"]);
  });
  it("ignores duplicate enqueues", async () => {
    let runs = 0;
    const q = createOcrQueue(async () => { runs++; return page("x"); }, { onState: () => {} });
    q.enqueue(job(0)); q.enqueue(job(0));
    await tick(); await tick();
    expect(runs).toBe(1);
  });
  it("times out a run that ignores the signal, then runs the next job", async () => {
    vi.useFakeTimers();
    try {
      const states: [number, OcrJobState, string | undefined][] = [];
      const q = createOcrQueue((j) => (j.pageIndex === 0 ? new Promise(() => {}) : Promise.resolve(page("ok"))), { onState: (j, s, e) => states.push([j.pageIndex, s, e?.error]) }, { timeoutMs: 1000 });
      q.enqueue(job(0)); q.enqueue(job(1));
      await vi.advanceTimersByTimeAsync(1100);
      expect(states).toContainEqual([0, "failed", "timeout"]);
      expect(states).toContainEqual([1, "done", undefined]);
      expect(q.pending).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("reports timeout even when the run resolves late after the abort", async () => {
    vi.useFakeTimers();
    try {
      const d = deferred<ReturnType<typeof page>>();
      const states: [OcrJobState, string | undefined][] = [];
      const q = createOcrQueue(() => d.promise, { onState: (_j, s, e) => states.push([s, e?.error]) }, { timeoutMs: 1000 });
      q.enqueue(job(0));
      await vi.advanceTimersByTimeAsync(1100);
      d.resolve(page("late")); await vi.advanceTimersByTimeAsync(10);
      expect(states.filter(([s]) => s !== "queued" && s !== "running")).toEqual([["failed", "timeout"]]);
    } finally { vi.useRealTimers(); }
  });
  it("allows immediate re-enqueue after cancelSource and ignores the late settle", async () => {
    const ds = [deferred<ReturnType<typeof page>>(), deferred<ReturnType<typeof page>>()];
    let runs = 0;
    const states: OcrJobState[] = [];
    const q = createOcrQueue(() => ds[runs++].promise, { onState: (_j, s) => states.push(s) });
    q.enqueue(job(0));
    await tick();
    q.cancelSource("s1");
    q.enqueue(job(0));
    await tick();
    expect(runs).toBe(2);
    ds[0].resolve(page("late")); await tick(); await tick();
    expect(states).toEqual(["queued", "running", "queued", "running"]);
    expect(q.pending).toBe(1);
    ds[1].resolve(page("x")); await tick(); await tick();
    expect(states.at(-1)).toBe("done");
    expect(q.pending).toBe(0);
  });
  it("lets an onState(failed) handler re-enqueue the same job", async () => {
    let runs = 0;
    const states: OcrJobState[] = [];
    const q = createOcrQueue(async () => { if (runs++ === 0) throw new Error("boom"); return page("x"); }, {
      onState: (j, s) => { states.push(s); if (s === "failed") q.enqueue(j); },
    });
    q.enqueue(job(0));
    await tick(); await tick(); await tick();
    expect(runs).toBe(2);
    expect(states.at(-1)).toBe("done");
  });
  it("emits nothing when a cancelled run resolves late", async () => {
    const d = deferred<ReturnType<typeof page>>();
    const states: OcrJobState[] = [];
    const q = createOcrQueue(() => d.promise, { onState: (_j, s) => states.push(s) });
    q.enqueue(job(0));
    await tick();
    q.cancelSource("s1");
    d.resolve(page("late")); await tick(); await tick();
    expect(states).toEqual(["queued", "running"]);
    expect(q.pending).toBe(0);
  });
});
