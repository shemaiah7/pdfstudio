import { z } from "zod";

export const MAX_DOC_CHARS = 600_000;
export const MAX_SELECTION_CHARS = 20_000;
export const MAX_QUESTION_CHARS = 2_000;

const pageSchema = z.object({ page: z.number().int().positive(), text: z.string() });
const turnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8_000) });

const base = z.object({
  document: z.array(pageSchema).min(1).max(2_000),
});

const union = z.discriminatedUnion("task", [
  base.extend({ task: z.literal("summarize") }),
  base.extend({
    task: z.literal("ask"),
    question: z.string().min(1).max(MAX_QUESTION_CHARS),
    history: z.array(turnSchema).max(10).optional(),
  }),
  base.extend({
    task: z.literal("rewrite"),
    selection: z.string().min(1).max(MAX_SELECTION_CHARS),
    mode: z.enum(["rewrite", "simplify", "formal", "translate", "explain"]),
    language: z.string().min(1).max(40).optional(),
  }),
  base.extend({ task: z.literal("extract") }),
]);

const schema = union.refine((b) => b.task !== "rewrite" || b.mode !== "translate" || !!b.language, {
  message: "language required for translate",
});

export type AiBody = z.infer<typeof schema>;
export type Task = AiBody["task"];
export type RewriteMode = "rewrite" | "simplify" | "formal" | "translate" | "explain";
export type Validation =
  | { ok: true; body: AiBody }
  | { ok: false; status: 400 | 413; error: string; maxChars?: number };

export function validateAiBody(input: unknown): Validation {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid_body" };
  const total = parsed.data.document.reduce((n, p) => n + p.text.length, 0);
  if (total > MAX_DOC_CHARS) return { ok: false, status: 413, error: "document_too_large", maxChars: MAX_DOC_CHARS };
  return { ok: true, body: parsed.data };
}
