import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import type { BuiltRequest } from "./request";

export interface StreamResult {
  events: AsyncIterable<{ type: "text"; text: string }>;
  final(): Promise<{ inputTokens: number; outputTokens: number; stop: string }>;
  /** Tokens observed so far (usable when the stream is interrupted). */
  usageSoFar(): { inputTokens: number; outputTokens: number };
  /** Cancel the upstream request, if supported. */
  abort?(): void;
}
export type StreamFn = (params: BuiltRequest, env: Env) => Promise<StreamResult>;

export const streamWithSdk: StreamFn = async (params, env) => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const stream = client.beta.messages.stream(params);
  // The stream is lazy; wait for the HTTP response so 429/529/5xx throw here, not mid-iteration.
  await stream.withResponse();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const events = (async function* () {
    for await (const event of stream) {
      if (event.type === "message_start") {
        const u = event.message.usage;
        usage.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
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
      const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      return { inputTokens, outputTokens: u.output_tokens ?? 0, stop: m.stop_reason ?? "end_turn" };
    },
  };
};

export function mapError(err: unknown): "busy" | "upstream" {
  const status = (err as { status?: number })?.status;
  if (status === 429 || (status !== undefined && status >= 500)) return "busy";
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return "busy";
  return "upstream";
}
