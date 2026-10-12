// worker/scripts/provision-agent.ts
// Run from the repo root: npx tsx worker/scripts/provision-agent.ts
// Reads ELEVENLABS_API_KEY from worker/.dev.vars; never prints it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { provisionAgent, type ElApi } from "../src/provision";

const vars = Object.fromEntries(readFileSync(resolve(process.cwd(), "worker/.dev.vars"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const key = vars.ELEVENLABS_API_KEY;
if (!key) { console.error("ELEVENLABS_API_KEY missing in worker/.dev.vars"); process.exit(1); }

const base = "https://api.elevenlabs.io";
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) console.error(`${method} ${path} -> ${res.status}`, JSON.stringify(json).slice(0, 400));
  return { status: res.status, body: json };
}
const api: ElApi = { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), patch: (p, b) => call("PATCH", p, b) };

const hostnames = (process.env.VOICE_HOSTNAMES ?? "pdfstudio.shemaiah7.workers.dev,localhost").split(",").map((h) => h.trim()).filter(Boolean);
const r = await provisionAgent(api, hostnames);
console.log(JSON.stringify({ agentId: r.agentId, toolId: r.toolId, zeroRetention: r.zeroRetention, privacy: r.privacy }, null, 2));
console.log(`\nNext: set "ELEVENLABS_AGENT_ID": "${r.agentId}" in worker/wrangler.jsonc vars and ELEVENLABS_AGENT_ID=${r.agentId} in worker/.dev.vars.`);
