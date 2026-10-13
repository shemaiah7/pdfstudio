import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("D1 schema", () => {
  it("has users and stripe_events", async () => {
    const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>();
    expect(r.results.map((x) => x.name)).toEqual(expect.arrayContaining(["users", "stripe_events"]));
  });
});
