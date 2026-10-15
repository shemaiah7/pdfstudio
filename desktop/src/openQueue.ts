export interface QueuedFile { name: string; bytes: Uint8Array }

/** Holds opened files until the page has subscribed, so launches and reloads never drop or repeat a file. */
export class OpenQueue {
  private held: QueuedFile[] = [];
  private ready = false;
  constructor(private readonly deliver: (f: QueuedFile) => void) {}
  push(f: QueuedFile): void { if (this.ready) this.deliver(f); else this.held.push(f); }
  markReady(): void {
    this.ready = true;
    const pending = this.held; this.held = [];
    for (const f of pending) this.deliver(f);
  }
  markNotReady(): void { this.ready = false; }
}
