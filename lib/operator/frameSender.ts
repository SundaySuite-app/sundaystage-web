/**
 * The web operator's frame write path.
 *
 * Every transport action (show slide, next/prev, black/logo, edit the live
 * slide) POSTs a WebFrame to /api/sessions/<id>/frame. A bare fetch per action
 * has two failure modes on a phone over church wifi:
 *   1. A fast operator (or a held-down arrow key) opens several POSTs at once,
 *      and they can land OUT OF ORDER — the projector ends up on a slide the
 *      operator already stepped past.
 *   2. Nothing carries `client_seq`, so the server's stale-frame guard
 *      (409 `stale_client_seq`) can never fire — it has nothing to compare.
 *
 * FrameCoalescer fixes both: at most ONE POST in flight, newer frames replace
 * the queued one (intermediate frames are skippable — only the latest matters
 * on a display), and each send is stamped with a monotonic client_seq the
 * server can order against.
 *
 * This module is the (testable) seam between that pure coalescer and the
 * network. The component only calls `.push(frame)`.
 */
import { FrameCoalescer, type SendResultInfo } from "@/lib/coalesce";
import type { WebFrame } from "@/lib/webframe";

export interface FrameSenderOptions {
  /** The session this operator drives (stable for the page's lifetime). */
  sessionId: string;
  /**
   * Request headers, read FRESH on every send: the session secret resolves
   * asynchronously (localStorage or the desktop deep-link fragment), so a
   * sender built at mount would otherwise be pinned to an empty bearer.
   */
  headers: () => HeadersInit;
  /** The session is gone (404/410) — the console should bail out. */
  onLost: () => void;
}

export function createFrameSender(opts: FrameSenderOptions): FrameCoalescer<WebFrame> {
  return new FrameCoalescer<WebFrame>(
    async (frame, clientSeq): Promise<SendResultInfo> => {
      const res = await fetch(`/api/sessions/${opts.sessionId}/frame`, {
        method: "POST",
        headers: opts.headers(),
        body: JSON.stringify({ frame, client_seq: clientSeq }),
      });
      if (res.status === 410 || res.status === 404) opts.onLost();
      // 409 stale_client_seq is BENIGN and expected: it means a NEWER frame
      // already landed, so the display is ahead of this one — exactly the race
      // client_seq exists to resolve. Reporting it as an error would light the
      // operator's status red for the guard doing its job.
      return { ok: res.ok || res.status === 409, status: res.status };
    },
  );
}
