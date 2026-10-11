import { describe, it, expect } from "vitest";
import { streamWithSdk } from "../src/claude";
import { buildRequest } from "../src/request";

// vitest.config.ts injects ANTHROPIC_API_KEY="test-key" as a binding; treat that as unset.
const raw = process.env.ANTHROPIC_API_KEY;
const key = raw && raw !== "test-key" ? raw : undefined;

describe.skipIf(!key)("live Claude", () => {
  it("summarizes a tiny document", async () => {
    const env = { ANTHROPIC_API_KEY: key! } as never;
    const r = await streamWithSdk(buildRequest({ task: "summarize", document: [{ page: 1, text: "Invoice 42. Total due: $100 by 2026-11-01." }, { page: 2, text: "Thank you." }] }), env);
    let out = "";
    for await (const e of r.events) out += e.text;
    const f = await r.final();
    expect(out.length).toBeGreaterThan(10);
    expect(f.outputTokens).toBeGreaterThan(0);
  }, 60_000);
});
