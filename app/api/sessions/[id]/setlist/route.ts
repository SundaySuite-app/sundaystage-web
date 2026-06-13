/** PUT /api/sessions/<id>/setlist — persist the web operator's slides so a
 * refresh resumes where they left off. Bearer-authed; shape is operator-owned
 * (size-capped, otherwise opaque). */
import { ok, fail, readJson, bearer } from "@/lib/server/http";
import { saveSetlist, verifySecret } from "@/lib/server/sessions";

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!(await verifySecret(id, bearer(req)))) return fail(401, "unauthorized");
  const body = await readJson<{ setlist?: unknown }>(req);
  if (body?.setlist === undefined) return fail(400, "missing_setlist");
  if (JSON.stringify(body.setlist).length > 512 * 1024) return fail(413, "setlist_too_large");
  await saveSetlist(id, body.setlist);
  return ok({ saved: true });
}
