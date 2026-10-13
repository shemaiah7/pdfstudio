// pdf.js 6 reads page text with `for await (const value of readableStream)` (PDFPageProxy.getTextContent).
// Safari's ReadableStream has no async iterator, so every text read failed there ("undefined is not a
// function near '...e of t...'"): the text layer, Edit text, search indexing and AI / Voice context.
// Install the standard values() / Symbol.asyncIterator when missing; native implementations are left alone.

type StreamCtor = { prototype: { getReader(): { read(): Promise<{ done: boolean; value?: unknown }>; cancel(reason?: unknown): Promise<void>; releaseLock(): void } } };

export function installStreamIteration(Stream: StreamCtor | undefined = globalThis.ReadableStream as unknown as StreamCtor | undefined): void {
  if (!Stream || Symbol.asyncIterator in Stream.prototype) return;
  function values(this: StreamCtor["prototype"], { preventCancel = false }: { preventCancel?: boolean } = {}) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const r = await reader.read();
          if (r.done) reader.releaseLock();
          return r;
        } catch (err) { reader.releaseLock(); throw err; }
      },
      async return(value?: unknown) {
        if (!preventCancel) { const cancelled = reader.cancel(value); reader.releaseLock(); await cancelled; }
        else reader.releaseLock();
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  }
  Object.defineProperty(Stream.prototype, "values", { value: values, writable: true, configurable: true });
  Object.defineProperty(Stream.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

installStreamIteration();
