import { SUMMARIZE } from "./summarize";
import { ASK } from "./ask";
import { REWRITE } from "./rewrite";
import { EXTRACT } from "./extract";
import { ASK_RETRIEVED } from "./askRetrieved";
import type { Task } from "../validate";

export const PROMPTS: Record<Task | "askRetrieved", string> = { summarize: SUMMARIZE, ask: ASK, askRetrieved: ASK_RETRIEVED, rewrite: REWRITE, extract: EXTRACT };
