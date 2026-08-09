/**
 * The RPC seam in lib/server/sessions.ts: Postgres raises `session_not_found`
 * (P0002) / `session_closed` (P0003) from stage.next_cmd_seq, and the route
 * turns those into 404/410. Both sides look correct in isolation — this pins
 * the translation between them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { nextCmdSeq } from "@/lib/server/sessions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nextCmdSeq", () => {
  it("calls the stage RPC with the session id and returns the assigned seq", async () => {
    mocks.rpc.mockResolvedValue({ data: 1_790_000_000_123, error: null });
    const r = await nextCmdSeq("sess-1");
    expect(mocks.rpc).toHaveBeenCalledWith("next_cmd_seq", { p_id: "sess-1" });
    expect(r).toEqual({ ok: true, seq: 1_790_000_000_123 });
  });

  it("coerces a bigint returned as a string (PostgREST numeric handling)", async () => {
    mocks.rpc.mockResolvedValue({ data: "1790000000123", error: null });
    const r = await nextCmdSeq("sess-1");
    expect(r).toEqual({ ok: true, seq: 1_790_000_000_123 });
  });

  it("maps session_not_found → not_found", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'session_not_found' } });
    expect(await nextCmdSeq("sess-1")).toEqual({ ok: false, reason: "not_found" });
  });

  it("maps session_closed → closed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'session_closed' } });
    expect(await nextCmdSeq("sess-1")).toEqual({ ok: false, reason: "closed" });
  });

  it("rethrows anything else (a broken RPC must not look like a dead session)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    await expect(nextCmdSeq("sess-1")).rejects.toMatchObject({ message: "connection reset" });
  });
});
