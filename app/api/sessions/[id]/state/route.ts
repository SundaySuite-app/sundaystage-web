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
  return ok({
    seq: session.current_seq,
    frame: session.current_frame,
    status: session.status,
    setlist: session.setlist ?? null,
  });
}
