import { describe, it, expect } from "vitest";
import { adaptStream } from "../src/claude";

type Ev = Record<string, unknown>;

/** Minimal stream: events pushed by withResponse() are only delivered if an iterator was attached first. */
function stubStream(events: Ev[], opts: { requireAttached?: boolean } = {}) {
  let attached = false;
  const queue: Ev[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  const stub = {
    controller: new AbortController(),
    [Symbol.asyncIterator]() {
      attached = true;
      return {
        async next() {
          for (;;) {
            if (queue.length) return { value: queue.shift(), done: false };
            if (ended) return { value: undefined, done: true };
            await new Promise<void>((r) => { wake = r; });
          }
        },
        async return() { return { value: undefined, done: true }; },
      };
    },
    async withResponse() {
      if (attached || !opts.requireAttached) queue.push(...events);
      ended = true;
      wake?.();
      return {};
    },
    async finalMessage() { return { usage: { input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 7 }, stop_reason: "end_turn" }; },
  };
  return stub as unknown as Parameters<typeof adaptStream>[0];
}

const evs = (usage: Ev): Ev[] => [
  { type: "message_start", message: { usage } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
  { type: "message_delta", usage: { output_tokens: 7 } },
];

describe("adaptStream", () => {
  it("attaches the iterator before awaiting the connection and yields deltas", async () => {
    const r = await adaptStream(stubStream(evs({ input_tokens: 100, output_tokens: 1 }), { requireAttached: true }));
    const out: string[] = [];
    for await (const e of r.events) out.push(e.text);
    expect(out).toEqual(["Hi"]);
    expect(r.usageSoFar()).toEqual({ inputTokens: 100, outputTokens: 7 });
  });

  it("weights cache reads at 0.1 in usageSoFar and final", async () => {
    const r = await adaptStream(stubStream(evs({ input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 1 }), { requireAttached: true }));
    for await (const _ of r.events) void _;
    expect(r.usageSoFar().inputTokens).toBe(200);
    expect((await r.final()).inputTokens).toBe(200);
  });
});
