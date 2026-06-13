import { describe, expect, it } from "vitest";
import { FrameCoalescer } from "@/lib/coalesce";

/** A controllable send: resolves when we release it. */
function gatedSend() {
  const calls: { payload: string; clientSeq: number }[] = [];
  let release: (() => void) | null = null;
  const send = (payload: string, clientSeq: number) => {
    calls.push({ payload, clientSeq });
    return new Promise<{ ok: boolean }>((resolve) => {
      release = () => resolve({ ok: true });
    });
  };
  return { calls, send, releaseOne: () => release?.() };
}

describe("FrameCoalescer", () => {
  it("a burst while one POST is in flight collapses to the latest frame", async () => {
    const { calls, send, releaseOne } = gatedSend();
    const c = new FrameCoalescer<string>(send);

    c.push("frame-1"); // goes in flight immediately
    c.push("frame-2"); // queued…
    c.push("frame-3"); // …replaced by 3 (2 is skippable)
    expect(calls).toHaveLength(1);

    releaseOne(); // finish frame-1 → drains the latest
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[1].payload).toBe("frame-3");

    releaseOne();
    await Promise.resolve();
    expect(calls).toHaveLength(2); // nothing left
  });

  it("client_seq is strictly monotonic across sends", async () => {
    const { calls, send, releaseOne } = gatedSend();
    const c = new FrameCoalescer<string>(send);
    c.push("a");
    releaseOne();
    await Promise.resolve();
    await Promise.resolve();
    c.push("b");
    releaseOne();
    await Promise.resolve();
    expect(calls.map((x) => x.clientSeq)).toEqual([1, 2]);
  });

  it("send failures surface in errorState and never throw", async () => {
    const c = new FrameCoalescer<string>(async () => ({ ok: false, status: 409 }));
    c.push("x");
    await new Promise((r) => setTimeout(r, 0));
    expect(c.errorState).toBe("http_409");

    const c2 = new FrameCoalescer<string>(async () => {
      throw new Error("nett nede");
    });
    c2.push("y");
    await new Promise((r) => setTimeout(r, 0));
    expect(c2.errorState).toBe("nett nede");
  });
});
