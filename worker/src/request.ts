import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { PROMPTS } from "./prompts";
import type { AiBody } from "./validate";

export const MODEL = "claude-sonnet-5-5";

export const EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          page: { type: "integer" },
        },
        required: ["label", "value", "page"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function documentBlock(doc: AiBody["document"]): Anthropic.Beta.BetaTextBlockParam {
  const text = `<document>\n${doc.map((p) => `<page n="${p.page}">${escapeText(p.text)}</page>`).join("\n")}\n</document>`;
  return { type: "text", text, cache_control: { type: "ephemeral" } };
}

export type BuiltRequest = BetaMessageStreamParams & {
  system: Anthropic.Beta.BetaTextBlockParam[];
  betas: string[];
  fallbacks: "default";
};

export function buildRequest(body: AiBody): BuiltRequest {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: PROMPTS[body.task], cache_control: { type: "ephemeral" } },
  ];
  const doc = documentBlock(body.document);
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  let effort: "low" | "medium" = "low";
  let format: Record<string, unknown> | undefined;

  switch (body.task) {
    case "summarize":
      messages.push({ role: "user", content: [doc, { type: "text", text: "Summarize this document." }] });
      break;
    case "ask": {
      const history = (body.history ?? []).filter((t, i) => !(i === 0 && t.role === "assistant"));
      if (history.length === 0) {
        messages.push({ role: "user", content: [doc, { type: "text", text: body.question }] });
      } else {
        messages.push({ role: "user", content: [doc, { type: "text", text: history[0].text }] });
        for (const turn of history.slice(1)) messages.push({ role: turn.role, content: [{ type: "text", text: turn.text }] });
        messages.push({ role: "user", content: [{ type: "text", text: body.question }] });
      }
      break;
    }
    case "rewrite": {
      const lines = [`Mode: ${body.mode}`];
      if (body.mode === "translate") lines.push(`Target language: ${body.language}`);
      lines.push(`<selection>${escapeText(body.selection)}</selection>`);
      messages.push({ role: "user", content: [doc, { type: "text", text: lines.join("\n") }] });
      break;
    }
    case "extract":
      effort = "medium";
      format = { type: "json_schema", schema: EXTRACT_SCHEMA };
      messages.push({ role: "user", content: [doc, { type: "text", text: "Extract the key facts." }] });
      break;
  }

  return {
    model: MODEL,
    max_tokens: 8000,
    system,
    messages,
    output_config: format ? { effort, format } : { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  } as unknown as BuiltRequest;
}
