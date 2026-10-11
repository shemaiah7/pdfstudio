import { describe, it, expect } from "vitest";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("emits each event once across split chunks and multiple events per chunk", () => {
    const seen: string[] = [];
    const p = createSseParser((e) => seen.push(`${e.event}:${e.data}`));
    p.push('event: delta\ndata: {"text":"a"}\n\nevent: del');
    p.push('ta\ndata: {"text":"b"}\n\n');
    p.push('event: done\ndata: {"x":1}\n');
    p.end();
    expect(seen).toEqual(['delta:{"text":"a"}', 'delta:{"text":"b"}', 'done:{"x":1}']);
  });
  it("defaults event name to message and ignores comments", () => {
    const seen: string[] = [];
    const p = createSseParser((e) => seen.push(`${e.event}:${e.data}`));
    p.push(": keepalive\n\ndata: hi\n\n");
    expect(seen).toEqual(["message:hi"]);
  });
});
