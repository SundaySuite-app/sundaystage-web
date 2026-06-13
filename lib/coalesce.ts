/**
 * Latest-wins frame sender: at most ONE POST in flight; while it flies, newer
 * frames replace the queued one (intermediate frames are skippable — only the
 * latest matters on a display). This is both the throttle and the ordering
 * guarantee, and it stamps a monotonic client_seq so the server can reject
 * anything that arrives out of order.
 */

export interface SendResultInfo {
  ok: boolean;
  status?: number;
}

type SendFn<T> = (payload: T, clientSeq: number) => Promise<SendResultInfo>;

export class FrameCoalescer<T> {
  private inFlight = false;
  private pending: T | null = null;
  private clientSeq = 0;
  private lastError: string | null = null;
  private sendFn: SendFn<T>;

  constructor(sendFn: SendFn<T>) {
    this.sendFn = sendFn;
  }

  /** Queue a frame; returns immediately. */
  push(frame: T): void {
    this.pending = frame;
    void this.drain();
  }

  /** Current error state ("" when healthy) — for a status dot in the UI. */
  get errorState(): string | null {
    return this.lastError;
  }

  get sentCount(): number {
    return this.clientSeq;
  }

  private async drain(): Promise<void> {
    if (this.inFlight) return;
    while (this.pending !== null) {
      const frame = this.pending;
      this.pending = null;
      this.inFlight = true;
      this.clientSeq += 1;
      try {
        const res = await this.sendFn(frame, this.clientSeq);
        this.lastError = res.ok ? null : `http_${res.status ?? "error"}`;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
      } finally {
        this.inFlight = false;
      }
    }
  }
}
