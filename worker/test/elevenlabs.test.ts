import { describe, it, expect } from "vitest";
import { createConversationToken, getConversationDuration, ElevenLabsError } from "../src/elevenlabs";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createConversationToken", () => {
  it("GETs the token endpoint with the key header and maps the reply", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => { seen = { url, init }; return ok({ token: "tok", conversation_id: "conv_1" }); }) as unknown as typeof fetch;
    const r = await createConversationToken("k", "agent_x", fetchFn);
    expect(r).toEqual({ token: "tok", conversationId: "conv_1" });
    expect(seen!.url).toBe("https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_x");
    expect(seen!.init.method).toBe("GET");
    expect((seen!.init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
  });
  it("throws ElevenLabsError with the upstream status on non-2xx", async () => {
    const fetchFn = (async () => ok({ detail: "nope" }, 401)) as unknown as typeof fetch;
    await expect(createConversationToken("k", "a", fetchFn)).rejects.toMatchObject({ name: "ElevenLabsError", status: 401 });
  });
  it("throws ElevenLabsError status 0 on network failure", async () => {
    const fetchFn = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    await expect(createConversationToken("k", "a", fetchFn)).rejects.toBeInstanceOf(ElevenLabsError);
  });
  it("rejects a reply without a token", async () => {
    const fetchFn = (async () => ok({ conversation_id: "c" })) as unknown as typeof fetch;
    await expect(createConversationToken("k", "a", fetchFn)).rejects.toMatchObject({ status: 502 });
  });
});

describe("getConversationDuration", () => {
  it("returns call_duration_secs", async () => {
    const fetchFn = (async (url: string) => { expect(url).toBe("https://api.elevenlabs.io/v1/convai/conversations/conv_1"); return ok({ status: "done", metadata: { call_duration_secs: 42 } }); }) as unknown as typeof fetch;
    expect(await getConversationDuration("k", "conv_1", fetchFn)).toBe(42);
  });
  it("returns the duration only once the conversation has finished", async () => {
    const mk = (status: string, secs: number) => (async () => ok({ status, metadata: { call_duration_secs: secs } })) as unknown as typeof fetch;
    expect(await getConversationDuration("k", "c", mk("in-progress", 3))).toBeNull();
    expect(await getConversationDuration("k", "c", mk("initiated", 3))).toBeNull();
    expect(await getConversationDuration("k", "c", mk("processing", 42))).toBe(42);
    expect(await getConversationDuration("k", "c", mk("failed", 7))).toBe(7);
  });
  it("returns null on 404, network error, or a missing field", async () => {
    expect(await getConversationDuration("k", "c", (async () => ok({}, 404)) as unknown as typeof fetch)).toBeNull();
    expect(await getConversationDuration("k", "c", (async () => { throw new Error("net"); }) as unknown as typeof fetch)).toBeNull();
    expect(await getConversationDuration("k", "c", (async () => ok({ status: "done", metadata: {} })) as unknown as typeof fetch)).toBeNull();
  });
});
