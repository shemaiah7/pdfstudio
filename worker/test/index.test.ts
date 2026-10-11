import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";

async function call(path: string, init: RequestInit = {}) {
  const req = new Request(`https://ai.example${path}`, init);
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("routing", () => {
  it("answers preflight with CORS headers", async () => {
    const res = await call("/ai", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("404s unknown paths as JSON with CORS", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rejects GET on /ai", async () => {
    const res = await call("/ai", { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("echoes a listed Origin and falls back to the first entry otherwise", async () => {
    const listed = await call("/ai", { method: "OPTIONS", headers: { origin: "http://localhost:5175" } });
    expect(listed.headers.get("access-control-allow-origin")).toBe("http://localhost:5175");
    const other = await call("/ai", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
