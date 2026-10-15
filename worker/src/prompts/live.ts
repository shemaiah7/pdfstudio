// worker/src/prompts/live.ts
export const AGENT_NAME = "PDF Studio Voice";
export const SEARCH_TOOL_NAME = "search_document";
export const LIVE_LLM = "claude-sonnet-5-5";

export const LIVE_INSTRUCTIONS =
  "You are a voice assistant for a clinician reading a document in SentinelPDF. You cannot see the document. " +
  "Before answering any question about its contents, call search_document with the key words of the question; you may call it more than once with different words. " +
  "Answer only from the passages it returns and cite the page. If nothing relevant comes back, say so briefly and offer to look again with different words. " +
  "Read numbers, units, dates, and names slowly and exactly as written. Do not give diagnoses or treatment advice beyond what the document states. " +
  "Keep answers to two or three sentences; the user is working hands-free.";

export function searchToolBody() {
  return {
    tool_config: {
      type: "client",
      name: SEARCH_TOOL_NAME,
      description: "Search the document the user has open and return the most relevant passages with page numbers. Call this before answering any question about the document's contents.",
      expects_response: true,
      response_timeout_secs: 10,
      parameters: { type: "object", properties: { query: { type: "string", description: "Key words or a short question to search for" } }, required: ["query"] },
    },
  };
}

export function agentBody(toolId: string, hostnames: string[], zeroRetention: boolean) {
  const privacy: Record<string, unknown> = { record_voice: false, retention_days: zeroRetention ? -1 : 0, delete_transcript_and_pii: true, delete_audio: true, apply_to_existing_conversations: true };
  if (zeroRetention) privacy.zero_retention_mode = true;
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: "Ready. Ask me about the open document.",
        language: "en",
        prompt: { prompt: LIVE_INSTRUCTIONS, llm: LIVE_LLM, temperature: 0, tool_ids: [toolId] },
      },
      tts: { model_id: "eleven_v4_turbo", voice_id: "cjVigY5qzO86Huf0OWal" },
      turn: { turn_timeout: 7, turn_eagerness: "normal" },
      conversation: { max_duration_seconds: 600, client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call"] },
    },
    platform_settings: {
      auth: { enable_auth: true, allowlist: hostnames.map((hostname) => ({ hostname })) },
      privacy,
    },
  };
}
