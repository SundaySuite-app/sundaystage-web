/** POST /api/sessions/<id>/end — close the session and tell every viewer. */
import { ok, fail, bearer } from "@/lib/server/http";
import { endSession, verifySecret } from "@/lib/server/sessions";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!(await verifySecret(id, bearer(req)))) return fail(401, "unauthorized");
  await endSession(id);
  await broadcast(channels.session(id), events.session, { status: "ended" });
  return ok({ ended: true });
}
