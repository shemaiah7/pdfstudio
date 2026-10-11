import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import type { BuiltRequest } from "./request";
import { MODEL } from "./request";
import { OCR } from "./prompts/ocr";

export interface StreamResult {
  events: AsyncIterable<{ type: "text"; text: string }>;
  final(): Promise<{ inputTokens: number; outputTokens: number; stop: string }>;
  /** Tokens observed so far (usable when the stream is interrupted). */
  usageSoFar(): { inputTokens: number; outputTokens: number };
  /** Cancel the upstream request, if supported. */
  abort?(): void;
}
export type StreamFn = (params: BuiltRequest, env: Env) => Promise<StreamResult>;

type Usage = { input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; output_tokens?: number | null };

/** Cache reads are billed at ~0.1x, so weight them accordingly toward the token budget. */
function weightedInput(u: Usage): number {
  return Math.ceil((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0));
}

type SdkStream = ReturnType<InstanceType<typeof Anthropic>["beta"]["messages"]["stream"]>;

export async function adaptStream(stream: SdkStream): Promise<StreamResult> {
  // In SDK 0.80 the async iterator registers its listeners only when called; events emitted
  // before that are dropped (a dropped `end` hangs next() forever). Attach before awaiting.
  const iter = stream[Symbol.asyncIterator]();
  // The stream is lazy; wait for the HTTP response so 429/529/5xx throw here, not mid-iteration.
  await stream.withResponse();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const events = (async function* () {
    for (;;) {
      const { value: event, done } = await iter.next();
      if (done) return;
      if (event.type === "message_start") {
        const u = event.message.usage;
        usage.inputTokens = weightedInput(u);
        usage.outputTokens = u.output_tokens ?? 0;
      } else if (event.type === "message_delta") {
        usage.outputTokens = event.usage.output_tokens ?? usage.outputTokens;
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text" as const, text: event.delta.text };
      }
    }
  })();
  return {
    events,
    usageSoFar: () => ({ ...usage }),
    abort: () => stream.controller.abort(),
    async final() {
      const m = await stream.finalMessage();
      const u = m.usage;
      return { inputTokens: weightedInput(u), outputTokens: u.output_tokens ?? 0, stop: m.stop_reason ?? "end_turn" };
    },
  };
}

export const streamWithSdk: StreamFn = async (params, env) => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return adaptStream(client.beta.messages.stream(params));
};

export function mapError(err: unknown): "busy" | "upstream" {
  const status = (err as { status?: number })?.status;
  const e = err as { error?: { type?: string; error?: { type?: string } } };
  const type = e?.error?.error?.type ?? e?.error?.type;
  if (type === "overloaded_error" || type === "rate_limit_error") return "busy";
  if (status === 429 || (status !== undefined && status >= 500)) return "busy";
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return "busy";
  return "upstream";
}

export type OcrFn = (image: string, env: Env) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
export const ocrWithSdk: OcrFn = async (image, env) => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const m = await client.beta.messages.create({
    model: MODEL, max_tokens: 4000,
    system: [{ type: "text", text: OCR, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } }, { type: "text", text: "Transcribe this page." }] }],
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
  } as never);
  const text = m.content.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text").map((c) => c.text).join("\n");
  return { text, inputTokens: weightedInput(m.usage), outputTokens: m.usage.output_tokens ?? 0 };
};
