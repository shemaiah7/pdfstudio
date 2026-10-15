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
    for (let i = 0; i < pending.length; i++) {
      try { this.deliver(pending[i]); } catch (err) {
        // The page can't take files right now: keep this one and the rest, and wait for the next ready signal.
        this.held = pending.slice(i).concat(this.held);
        this.ready = false;
        throw err;
      }
    }
  }
  markNotReady(): void { this.ready = false; }
}
