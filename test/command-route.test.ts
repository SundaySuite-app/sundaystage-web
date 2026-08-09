/**
 * Route-level assertions for POST /api/sessions/<id>/command.
 *
 * The seam this guards: the value the server SIGNS and BROADCASTS must be the
 * seq the RPC assigned — never one the client supplied. The desktop drops any
 * cmd_seq <= the highest it has seen, so signing the wrong number is invisible
 * on this side (200, valid HMAC) and fatal on the other (command ignored).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { channels, events } from "@/lib/realtime";
import { verifyCommandSig } from "@/lib/commandSig";

const mocks = vi.hoisted(() => ({
  verifySecret: vi.fn(),
  nextCmdSeq: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("@/lib/server/sessions", () => ({
  verifySecret: mocks.verifySecret,
  nextCmdSeq: mocks.nextCmdSeq,
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: mocks.broadcast }));

import { POST } from "@/app/api/sessions/[id]/command/route";

const SECRET = "s3cr3t";
/** Wall-clock-scale value, as the RPC's epoch-ms floor produces. */
const ASSIGNED = 1_790_000_000_123;

/** Fresh id per call so the per-session rate limiter never leaks across tests. */
let n = 0;
const newId = () => `sess-${++n}`;

function post(id: string, body: unknown, secret: string | null = SECRET) {
  const req = new Request(`https://x/api/sessions/${id}/command`, {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

/** The payload handed to the (mocked) broadcast. */
function sentPayload() {
  return mocks.broadcast.mock.calls[0]?.[2] as { cmd: string; cmd_seq: number; sig: string };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySecret.mockResolvedValue(true);
  mocks.nextCmdSeq.mockResolvedValue({ ok: true, seq: ASSIGNED });
  mocks.broadcast.mockResolvedValue(undefined);
});

describe("POST /api/sessions/[id]/command", () => {
  it("assigns the seq from the RPC and signs THAT value", async () => {
    const id = newId();
    const res = await post(id, { cmd: "next" });

    expect(res.status).toBe(200);
    expect(mocks.nextCmdSeq).toHaveBeenCalledWith(id);
    expect(await res.json()).toEqual({ sent: true, cmd_seq: ASSIGNED });

    const [topic, event, payload] = mocks.broadcast.mock.calls[0];
    expect(topic).toBe(channels.commands(id));
    expect(event).toBe(events.command);
    expect(payload.cmd_seq).toBe(ASSIGNED);
    // The HMAC must cover the ASSIGNED seq — this is what the desktop recomputes.
    expect(await verifyCommandSig(SECRET, id, "next", ASSIGNED, payload.sig)).toBe(true);
  });

  it("ACCEPTS but IGNORES a client-supplied cmd_seq (old operator builds)", async () => {
    const id = newId();
    const res = await post(id, { cmd: "black", cmd_seq: 7 });

    expect(res.status).toBe(200); // never 400 — that would kill the remote mid-service
    expect(await res.json()).toEqual({ sent: true, cmd_seq: ASSIGNED });
    const payload = sentPayload();
    expect(payload.cmd_seq).toBe(ASSIGNED);
    // And the signature does NOT cover the client's number.
    expect(await verifyCommandSig(SECRET, id, "black", 7, payload.sig)).toBe(false);
  });

  it("works with no cmd_seq in the body at all (new operator build)", async () => {
    const res = await post(newId(), { cmd: "logo" });
    expect(res.status).toBe(200);
    expect(sentPayload().cmd_seq).toBe(ASSIGNED);
  });

  it("two sequential commands carry the strictly increasing seqs the RPC hands out", async () => {
    mocks.nextCmdSeq
      .mockResolvedValueOnce({ ok: true, seq: ASSIGNED })
      .mockResolvedValueOnce({ ok: true, seq: ASSIGNED + 1 });
    const id = newId();

    const first = await (await post(id, { cmd: "next" })).json();
    const second = await (await post(id, { cmd: "next" })).json();

    expect(second.cmd_seq).toBeGreaterThan(first.cmd_seq);
    const seqs = mocks.broadcast.mock.calls.map((c) => (c[2] as { cmd_seq: number }).cmd_seq);
    expect(seqs).toEqual([ASSIGNED, ASSIGNED + 1]);
  });

  it("maps session_not_found → 404 and broadcasts nothing", async () => {
    mocks.nextCmdSeq.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await post(newId(), { cmd: "next" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("maps session_closed → 410 and broadcasts nothing", async () => {
    mocks.nextCmdSeq.mockResolvedValue({ ok: false, reason: "closed" });
    const res = await post(newId(), { cmd: "next" });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "session_closed" });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("401s a wrong secret without burning a sequence number", async () => {
    mocks.verifySecret.mockResolvedValue(false);
    const res = await post(newId(), { cmd: "next" }, "feil");
    expect(res.status).toBe(401);
    expect(mocks.nextCmdSeq).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("400s an unknown command before touching the sequence", async () => {
    const res = await post(newId(), { cmd: "selvdestruer" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_command" });
    expect(mocks.nextCmdSeq).not.toHaveBeenCalled();
  });
});
