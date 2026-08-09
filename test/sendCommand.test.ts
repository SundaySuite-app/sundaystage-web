import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandSender } from "@/lib/operator/sendCommand";

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fetchStub(seen: Seen[]) {
  const stub = vi.fn((url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    // The server answers with the seq IT assigned; the client has no use for it.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sent: true, cmd_seq: 1_790_000_000_123 }),
    } as Response);
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator command sender", () => {
  it("POSTs the bare command — NO cmd_seq (the server assigns it)", async () => {
    const seen: Seen[] = [];
    fetchStub(seen);
    const send = createCommandSender({
      sessionId: "sess-1",
      headers: () => ({ Authorization: "Bearer s" }),
    });

    await send("next");

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/api/sessions/sess-1/command");
    expect(seen[0].body).toEqual({ cmd: "next" });
    expect("cmd_seq" in seen[0].body).toBe(false);
    expect(seen[0].headers).toEqual({ Authorization: "Bearer s" });
  });

  it("never grows a client-side counter across a burst", async () => {
    const seen: Seen[] = [];
    fetchStub(seen);
    const send = createCommandSender({
      sessionId: "sess-1",
      headers: () => ({ Authorization: "Bearer s" }),
    });

    for (const cmd of ["next", "next", "black"] as const) await send(cmd);

    expect(seen.map((s) => s.body)).toEqual([
      { cmd: "next" },
      { cmd: "next" },
      { cmd: "black" },
    ]);
  });

  it("reads the headers FRESH on every send (the secret resolves after mount)", async () => {
    const seen: Seen[] = [];
    fetchStub(seen);
    let auth: HeadersInit = {};
    const send = createCommandSender({ sessionId: "sess-1", headers: () => auth });

    await send("next");
    auth = { Authorization: "Bearer late" };
    await send("prev");

    expect(seen[0].headers).toEqual({});
    expect(seen[1].headers).toEqual({ Authorization: "Bearer late" });
  });
});
