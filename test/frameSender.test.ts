import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameSender } from "@/lib/operator/frameSender";
import { WEBFRAME_VERSION, type WebFrame } from "@/lib/webframe";

const slide = (n: number): WebFrame => ({
  v: WEBFRAME_VERSION,
  kind: "slide",
  text_lines: [`line ${n}`],
});

interface Seen {
  url: string;
  headers: Record<string, string>;
  frame: WebFrame;
  clientSeq: unknown;
}

/** A fetch stub whose responses are released one at a time, so we can hold a
 *  POST "in flight" and observe what the sender does meanwhile. */
function gatedFetch(status: () => number = () => 200) {
  const seen: Seen[] = [];
  const gates: (() => void)[] = [];
  const fetchStub = vi.fn((url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { frame: WebFrame; client_seq: unknown };
    seen.push({
      url,
      headers: init.headers as Record<string, string>,
      frame: body.frame,
      clientSeq: body.client_seq,
    });
    return new Promise<Response>((resolve) => {
      const code = status();
      gates.push(() => resolve({ ok: code >= 200 && code < 300, status: code } as Response));
    });
  });
  vi.stubGlobal("fetch", fetchStub);
  let released = 0;
  return {
    seen,
    releaseOne: () => {
      gates[released]?.();
      released++;
    },
  } as const;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Let the coalescer's await chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("operator frame sender (coalescer wired to /frame)", () => {
  it("a burst collapses to the latest frame, one POST at a time", async () => {
    const net = gatedFetch();
    const sender = createFrameSender({
      sessionId: "sess-1",
      headers: () => ({ Authorization: "Bearer s" }),
      onLost: () => {},
    });

    sender.push(slide(1)); // in flight immediately
    sender.push(slide(2)); // queued…
    sender.push(slide(3)); // …replaced by 3 — 2 is skippable
    expect(net.seen).toHaveLength(1); // never two POSTs at once
    expect(net.seen[0].frame.text_lines).toEqual(["line 1"]);

    net.releaseOne();
    await settle();
    expect(net.seen).toHaveLength(2);
    expect(net.seen[1].frame.text_lines).toEqual(["line 3"]); // latest wins

    net.releaseOne();
    await settle();
    expect(net.seen).toHaveLength(2); // queue drained, nothing extra sent
  });

  it("every POST carries a monotonic client_seq (the server's stale guard)", async () => {
    const net = gatedFetch();
    const sender = createFrameSender({
      sessionId: "sess-1",
      headers: () => ({ Authorization: "Bearer s" }),
      onLost: () => {},
    });

    for (let i = 1; i <= 3; i++) {
      sender.push(slide(i));
      net.releaseOne();
      await settle();
    }
    expect(net.seen.map((s) => s.clientSeq)).toEqual([1, 2, 3]);
    expect(net.seen[0].url).toBe("/api/sessions/sess-1/frame");
  });

  it("reads headers fresh, so a late-resolving session secret is used", async () => {
    const net = gatedFetch();
    let secret = "";
    const sender = createFrameSender({
      sessionId: "sess-1",
      headers: () => ({ Authorization: `Bearer ${secret}` }),
      onLost: () => {},
    });

    secret = "deadbeef"; // resolved from localStorage after mount
    sender.push(slide(1));
    net.releaseOne();
    await settle();
    expect(net.seen[0].headers.Authorization).toBe("Bearer deadbeef");
  });

  it("409 stale_client_seq is tolerated: no error state, session not lost", async () => {
    const net = gatedFetch(() => 409);
    let lost = false;
    const sender = createFrameSender({
      sessionId: "sess-1",
      headers: () => ({}),
      onLost: () => {
        lost = true;
      },
    });

    sender.push(slide(1));
    net.releaseOne();
    await settle();
    expect(lost).toBe(false);
    expect(sender.errorState).toBeNull(); // a newer frame won — benign
  });

  it("410/404 marks the session lost and surfaces as an error", async () => {
    const net = gatedFetch(() => 410);
    let lost = false;
    const sender = createFrameSender({
      sessionId: "sess-1",
      headers: () => ({}),
      onLost: () => {
        lost = true;
      },
    });

    sender.push(slide(1));
    net.releaseOne();
    await settle();
    expect(lost).toBe(true);
    expect(sender.errorState).toBe("http_410");
  });
});
