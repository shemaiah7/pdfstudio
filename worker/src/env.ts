export interface Env {
  QUOTA: KVNamespace;
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_HOSTNAMES: string; // comma-separated
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_AGENT_ID: string;
  VOICE_DAILY_SECONDS?: string; // default "1800"
}
