/**
 * GET /api/sessions/<id>/state — polling fallback + reconnect catch-up.
 * Same payload the broadcast carries, served authoritatively.
 */
import { ok, fail } from "@/lib/server/http";
import { getById } from "@/lib/server/sessions";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const session = await getById(id);
  if (!session) return fail(404, "not_found");
  // An expired-but-never-ended session must not keep reporting "live":
  // by-code already refuses it and set_frame 410s, but a joined display polls
  // HERE — without this it would show a dead session as live forever.
  const expired =
    session.status === "live" && Date.parse(session.expires_at) <= Date.now();
  return ok({
    seq: session.current_seq,
    frame: session.current_frame,
    status: expired ? "ended" : session.status,
    origin: session.origin,
    title: session.title,
    setlist: session.setlist ?? null,
  });
}
