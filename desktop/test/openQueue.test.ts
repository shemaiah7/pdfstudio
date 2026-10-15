import { describe, it, expect, vi } from "vitest";
import { OpenQueue } from "../src/openQueue";

const f = (name: string) => ({ name, bytes: new Uint8Array([1]) });

describe("OpenQueue", () => {
  it("holds files until the page is ready, then delivers in order", () => {
    const deliver = vi.fn();
    const q = new OpenQueue(deliver);
    q.push(f("a.pdf")); q.push(f("b.pdf"));
    expect(deliver).not.toHaveBeenCalled();
    q.markReady();
    expect(deliver.mock.calls.map((c) => c[0].name)).toEqual(["a.pdf", "b.pdf"]);
  });
  it("delivers immediately once ready", () => {
    const deliver = vi.fn();
    const q = new OpenQueue(deliver);
    q.markReady(); q.push(f("c.pdf"));
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("after a reload, holds again and never duplicates", () => {
    const deliver = vi.fn();
    const q = new OpenQueue(deliver);
    q.markReady(); q.push(f("a.pdf"));
    q.markNotReady(); q.push(f("b.pdf"));
    expect(deliver).toHaveBeenCalledTimes(1);
    q.markReady(); q.markReady();
    expect(deliver.mock.calls.map((c) => c[0].name)).toEqual(["a.pdf", "b.pdf"]);
  });
});
