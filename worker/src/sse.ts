import type { Env } from "./env";
import { corsHeaders } from "./cors";

export type Send = (event: string, data: unknown) => void;

export function sseResponse(env: Env, run: (send: Send) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } catch {
        send("error", { error: "upstream" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...corsHeaders(env) },
  });
}
