import { describe, it, expect } from "vitest";
import { createClaudeEngine, encodeJpeg, type OcrApi } from "./claudeEngine";

const canvas = (w: number, bytes: number) => ({ width: w, height: w, toBlob: (cb: (b: Blob | null) => void, _t: string, _q: number) => cb(new Blob([new Uint8Array(bytes)])) }) as unknown as HTMLCanvasElement;

describe("encodeJpeg", () => {
  it("returns base64 of the first encoding under 4 MB", async () => {
    const b64 = await encodeJpeg(canvas(1568, 10), () => { throw new Error("should not downscale"); });
    expect(atob(b64).length).toBe(10);
  });
  it("downscales to 1200 then 900 before giving up", async () => {
    const edges: number[] = [];
    await expect(encodeJpeg(canvas(1568, 5_000_000), (c, e) => { edges.push(e); return c; })).rejects.toThrow("Page image too large");
    expect(edges).toEqual([1200, 900]);
  });
});

describe("createClaudeEngine", () => {
  it("posts one page and lays the returned lines out on the page", async () => {
    const sent: unknown[] = [];
    const api: OcrApi = { runOcr: async (pages) => { sent.push(pages); return { pages: [{ page: 1, lines: ["Hello", "world"] }], failed: [], remaining: { requests: 1, tokens: 1 }, resetAt: 0 }; } };
    const page = await createClaudeEngine(() => api).recognize(canvas(100, 5), { widthPt: 300, heightPt: 400 });
    expect((sent[0] as { page: number }[])[0].page).toBe(1);
    expect(page.engine).toBe("claude");
    expect(page.lines.map((l) => l.text)).toEqual(["Hello", "world"]);
  });
  it("throws when the page is reported failed or the api is missing", async () => {
    const api: OcrApi = { runOcr: async () => ({ pages: [], failed: [1], remaining: { requests: 1, tokens: 1 }, resetAt: 0 }) };
    await expect(createClaudeEngine(() => api).recognize(canvas(100, 5), { widthPt: 300, heightPt: 400 })).rejects.toThrow("upstream");
    await expect(createClaudeEngine(() => null).recognize(canvas(100, 5), { widthPt: 300, heightPt: 400 })).rejects.toThrow("not configured");
  });
});
