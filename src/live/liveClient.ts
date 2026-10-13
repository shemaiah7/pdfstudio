// src/live/liveClient.ts
import { NO_MATCH } from "./grounding";

export interface LiveEvents {
  onConnected(): void;
  onUserText(text: string): void;
  onAgentText(text: string): void;
  onAgentCorrection(text: string): void;
  onInterruption(): void;
  onError(message: string): void;
  onDisconnected(reason: "user" | "agent" | "error", message?: string): void;
}
export interface LiveTransport { createSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number; resetAt: number }> }
export type SearchTool = (query: string) => Promise<string>;
export interface LiveConversation { endSession(): Promise<void>; sendContextualUpdate(text: string): void; setMicMuted(muted: boolean): void; getId(): string; changeInputDevice?(o: { inputDeviceId: string }): Promise<void> }
export type StartSession = (opts: Record<string, unknown>) => Promise<LiveConversation>;

export const TOOL_TIMEOUT_MS = 8_000;

/** Lazily imports the SDK so the voice bundle only loads when a session starts. */
const sdkStartSession: StartSession = async (opts) => {
  const { Conversation } = await import("@elevenlabs/client");
  return (await Conversation.startSession(opts as never)) as unknown as LiveConversation;
};

export class LiveClient {
  private conv: LiveConversation | null = null;
  private disconnected = false;
  private started = false;
  private onDisconnectResolve: (() => void) | null = null;
  conversationId: string | null = null;
  private readonly startSession: StartSession;
  private readonly connectTimeoutMs: number;
  private readonly closeTimeoutMs: number;

  private readonly transport: LiveTransport;
  private readonly events: LiveEvents;
  private readonly search: SearchTool;

  constructor(transport: LiveTransport, events: LiveEvents, search: SearchTool, deps: { startSession?: StartSession; connectTimeoutMs?: number; closeTimeoutMs?: number } = {}) {
    this.transport = transport;
    this.events = events;
    this.search = search;
    this.startSession = deps.startSession ?? sdkStartSession;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? 15_000;
    this.closeTimeoutMs = deps.closeTimeoutMs ?? 5_000;
  }

  async start(inputDeviceId?: string): Promise<{ remainingSeconds: number }> {
    if (this.started) throw new Error("already_started");
    this.started = true;
    const session = await this.transport.createSession();
    this.conversationId = session.conversationId;
    let connected: () => void = () => {};
    let failConnect: (err: Error) => void = () => {};
    const connectedP = new Promise<void>((res, rej) => { connected = res; failConnect = rej; });
    connectedP.catch(() => {});
    const tool = async (params: unknown): Promise<string> => {
      const query = typeof (params as { query?: unknown })?.query === "string" ? (params as { query: string }).query : "";
      if (!query.trim()) return NO_MATCH;
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const timeout = new Promise<string>((r) => { timer = setTimeout(() => r(NO_MATCH), TOOL_TIMEOUT_MS); });
        const result = await Promise.race([this.search(query), timeout]);
        return result.trim() ? result : NO_MATCH;
      } catch { return NO_MATCH; } finally { if (timer) clearTimeout(timer); }
    };
    this.conv = await this.startSession({
      conversationToken: session.token,
      connectionType: "webrtc",
      clientTools: { search_document: tool },
      ...(inputDeviceId ? { inputDeviceId } : {}),
      onConnect: () => { connected(); this.events.onConnected(); },
      onDisconnect: (d: { reason: "user" | "agent" | "error"; message?: string }) => {
        this.disconnected = true;
        failConnect(new Error(d.reason === "error" && d.message ? d.message : "connection_lost"));
        this.onDisconnectResolve?.();
        this.events.onDisconnected(d.reason, d.reason === "error" ? d.message : undefined);
      },
      onError: (message: string) => { failConnect(new Error(message)); this.events.onError(message); },
      onMessage: (m: { role?: "user" | "agent"; source?: "user" | "ai"; message: string }) => {
        const role = m.role ?? (m.source === "ai" ? "agent" : "user");
        if (role === "user") this.events.onUserText(m.message); else this.events.onAgentText(m.message);
      },
      onAgentResponseCorrection: (c: { corrected_agent_response: string }) => this.events.onAgentCorrection(c.corrected_agent_response),
      onInterruption: () => this.events.onInterruption(),
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("connect_timeout")), this.connectTimeoutMs); });
    try { await Promise.race([connectedP, timeout]); } catch (err) { await this.close(); throw err; } finally { if (timer) clearTimeout(timer); }
    return { remainingSeconds: session.remainingSeconds };
  }

  sendContext(text: string): void { this.conv?.sendContextualUpdate(text); }
  mute(on: boolean): void { this.conv?.setMicMuted(on); }
  /** Switches the microphone of a live session; undefined means the system default. Failures go to onError. */
  async setInputDevice(id: string | undefined): Promise<void> {
    const conv = this.conv;
    if (!conv?.changeInputDevice) return;
    try { await conv.changeInputDevice({ inputDeviceId: id ?? "default" }); }
    catch (err) { this.events.onError(err instanceof Error ? err.message : "Could not switch microphone."); }
  }

  /** Ends the session; resolves when the SDK reports the disconnect or after closeTimeoutMs. */
  async close(): Promise<void> {
    const conv = this.conv;
    if (!conv) return;
    this.conv = null;
    if (this.disconnected) {
      try { await conv.endSession(); } catch { /* already closed */ }
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const gone = new Promise<void>((r) => { this.onDisconnectResolve = r; });
    const timeout = new Promise<void>((r) => { timer = setTimeout(r, this.closeTimeoutMs); });
    try {
      try { await conv.endSession(); } catch { /* already closed */ }
      await Promise.race([gone, timeout]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
