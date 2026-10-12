// Real-key smoke: E2E_LIVE=1 npx tsx worker/scripts/live-smoke.ts  (from the repo root)
// Mints a token for the provisioned agent, prints the agent's LLM and privacy settings, and the last
// conversation's duration / LLM usage / cost so the real per-minute cost can be read. Never prints the key.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.E2E_LIVE !== "1") { console.log("E2E_LIVE is not set; skipping the real-key smoke."); process.exit(0); }
let raw = "";
try { raw = readFileSync(resolve(process.cwd(), "worker/.dev.vars"), "utf8"); } catch { console.error("worker/.dev.vars not found (run from the repo root)"); process.exit(1); }
const vars = Object.fromEntries(raw.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const key = vars.ELEVENLABS_API_KEY; const agent = vars.ELEVENLABS_AGENT_ID;
if (!key || !agent) { console.error("ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID missing in worker/.dev.vars"); process.exit(1); }
const base = "https://api.elevenlabs.io";
type Body = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = async (p: string): Promise<{ status: number; body: Body }> => { const r = await fetch(base + p, { headers: { "xi-api-key": key } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const tok = await get(`/v1/convai/conversation/token?agent_id=${agent}`);
console.log(`token endpoint: ${tok.status} ${tok.status === 200 ? "(ok; token not printed)" : JSON.stringify(tok.body).slice(0, 300)}`);
if (tok.status < 200 || tok.status >= 300) process.exit(1);
const a = await get(`/v1/convai/agents/${agent}`);
console.log("agent:", JSON.stringify({ llm: a.body?.conversation_config?.agent?.prompt?.llm, tools: a.body?.conversation_config?.agent?.prompt?.tool_ids, privacy: a.body?.platform_settings?.privacy, max: a.body?.conversation_config?.conversation?.max_duration_seconds }, null, 2));
if (a.status < 200 || a.status >= 300) { console.error(`agent GET failed: ${a.status}`); process.exit(1); }
const list = await get(`/v1/convai/conversations?agent_id=${agent}&page_size=1`);
const last = list.body?.conversations?.[0];
if (!last) { console.log("no conversations yet"); process.exit(0); }
const c = await get(`/v1/convai/conversations/${last.conversation_id}`);
const llm = (c.body?.transcript ?? []).map((t: { llm_usage?: unknown }) => t.llm_usage).filter(Boolean);
console.log("last conversation:", JSON.stringify({ status: c.body?.status, call_duration_secs: c.body?.metadata?.call_duration_secs, cost: c.body?.metadata?.cost, cost_fiat: c.body?.metadata?.cost_fiat, llm_turns: llm.length, llm_usage: llm }, null, 2));
