import { describe, it, expect, vi } from "vitest";
import { installStreamIteration } from "./polyfills";

/** A ReadableStream look-alike without async iteration, like Safari's. */
function fakeStreamClass(chunks: string[]) {
  const cancel = vi.fn(async () => {});
  class FakeStream {
    getReader() {
      let i = 0;
      return {
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        cancel,
        releaseLock: vi.fn(),
      };
    }
  }
  return { FakeStream, cancel };
}

describe("installStreamIteration", () => {
  it("makes a stream without Symbol.asyncIterator iterable with for await", async () => {
    const { FakeStream } = fakeStreamClass(["a", "b", "c"]);
    expect(Symbol.asyncIterator in FakeStream.prototype).toBe(false);
    installStreamIteration(FakeStream as never);
    const out: string[] = [];
    for await (const chunk of new FakeStream() as unknown as AsyncIterable<string>) out.push(chunk);
    expect(out).toEqual(["a", "b", "c"]);
  });
  it("cancels the stream when the loop exits early", async () => {
    const { FakeStream, cancel } = fakeStreamClass(["a", "b", "c"]);
    installStreamIteration(FakeStream as never);
    for await (const chunk of new FakeStream() as unknown as AsyncIterable<string>) { if (chunk === "a") break; }
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("leaves a native implementation alone", () => {
    const native = async function* () {};
    class Native {}
    Object.defineProperty(Native.prototype, Symbol.asyncIterator, { value: native, configurable: true });
    installStreamIteration(Native as never);
    expect((Native.prototype as Record<symbol, unknown>)[Symbol.asyncIterator]).toBe(native);
    expect(Object.getOwnPropertyDescriptor(Native.prototype, "values")).toBeUndefined();
  });
});
