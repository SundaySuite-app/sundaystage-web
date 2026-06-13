/**
 * POST /api/sessions/<id>/frame — THE write path. Desktop forwarder and web
 * operator both land here with the session's bearer secret.
 * Body: { frame: WebFrame, client_seq?: number }
 * 401 bad secret · 404 unknown · 409 stale client_seq · 410 ended/expired.
 * On success: persists via the atomic RPC (server-assigned seq) and
 * broadcasts the envelope; broadcast failures are swallowed (polling heals).
 */
import { ok, fail, readJson, bearer } from "@/lib/server/http";
import { setFrame, verifySecret } from "@/lib/server/sessions";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { WebFrame } from "@/lib/webframe";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!(await verifySecret(id, bearer(req)))) return fail(401, "unauthorized");

  const body = await readJson<{ frame?: unknown; client_seq?: unknown }>(req);
  const parsed = WebFrame.safeParse(body?.frame);
  if (!parsed.success) return fail(400, "invalid_frame");
  const clientSeq =
    typeof body?.client_seq === "number" && Number.isFinite(body.client_seq)
      ? Math.trunc(body.client_seq)
      : null;

  const result = await setFrame(id, parsed.data, clientSeq);
  if (!result.ok) {
    if (result.reason === "stale") return fail(409, "stale_client_seq");
    if (result.reason === "closed") return fail(410, "session_closed");
    return fail(404, "not_found");
  }

  await broadcast(channels.session(id), events.frame, {
    v: 1,
    seq: result.seq,
    frame: parsed.data,
    emitted_at: new Date().toISOString(),
  });
  return ok({ seq: result.seq });
}
