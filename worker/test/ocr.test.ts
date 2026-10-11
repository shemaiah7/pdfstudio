import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { ocrHandler } from "../src/handlers/ocr";
import type { OcrFn } from "../src/claude";
import { signSession } from "../src/session";

const token = () => signSession({ vid: "vid-ocr", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
async function post(body: unknown, tok?: string, ocr: OcrFn = async () => ({ text: "line one\nline two\n", inputTokens: 1500, outputTokens: 20 })) {
  const req = new Request("https://ai.example/ocr", { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  const ctx = createExecutionContext();
  const res = await ocrHandler(req, env, ctx, ocr);
  const json = (await res.json().catch(() => null)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  await waitOnExecutionContext(ctx);
  return { res, json };
}
const body = { task: "ocr", pages: [{ page: 3, image: "/9j/4AAQ" }, { page: 5, image: "/9j/4AAQ" }] };

describe("POST /ocr", () => {
  it("401 without a session", async () => { expect((await post(body)).res.status).toBe(401); });
  it("400 on invalid body", async () => { expect((await post({ task: "ocr" }, await token())).res.status).toBe(400); });
  it("transcribes each page, splits lines, charges one request per page", async () => {
    const calls: string[] = [];
    const { res, json } = await post(body, await token(), async (image) => { calls.push(image); return { text: "a\n\nb\n", inputTokens: 10, outputTokens: 2 }; });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(json.pages).toEqual([{ page: 3, lines: ["a", "b"] }, { page: 5, lines: ["a", "b"] }]);
    expect(json.failed).toEqual([]);
    expect(json.remaining.requests).toBe(18);
    const state = await env.QUOTA.get(`q:vid-ocr:${new Date().toISOString().slice(0, 10)}`, "json");
    expect(state).toMatchObject({ requests: 2 });
  });
  it("reports a failed page without failing the batch", async () => {
    let n = 0;
    const { res, json } = await post(body, await token(), async () => { if (n++ === 0) throw Object.assign(new Error("boom"), { status: 500 }); return { text: "ok", inputTokens: 1, outputTokens: 1 }; });
    expect(res.status).toBe(200);
    expect(json.pages).toEqual([{ page: 5, lines: ["ok"] }]);
    expect(json.failed).toEqual([3]);
  });
  it("429 when the daily request quota cannot cover the batch", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.QUOTA.put(`q:vid-ocr2:${day}`, JSON.stringify({ requests: 19, tokens: 0 }));
    const tok = await signSession({ vid: "vid-ocr2", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const { res, json } = await post(body, tok);
    expect(res.status).toBe(429);
    expect(json.error).toBe("daily_limit");
  });
});
