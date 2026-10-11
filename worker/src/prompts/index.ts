import { SUMMARIZE } from "./summarize";
import { ASK } from "./ask";
import { REWRITE } from "./rewrite";
import { EXTRACT } from "./extract";
import type { Task } from "../validate";

export const PROMPTS: Record<Task, string> = { summarize: SUMMARIZE, ask: ASK, rewrite: REWRITE, extract: EXTRACT };
