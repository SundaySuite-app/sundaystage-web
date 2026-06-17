/** PUT /api/sessions/<id>/setlist — persist the web operator's slides so a
 * refresh resumes where they left off. Bearer-authed; the shape is validated
 * (slides + current index) and size-capped so a malformed/abusive PUT is
 * rejected here, not surfaced as a broken resume on a later read. */
import { ok, fail, readJson, bearer } from "@/lib/server/http";
import { saveSetlist, verifySecret } from "@/lib/server/sessions";
import { SetlistSchema } from "@/lib/setlist";

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!(await verifySecret(id, bearer(req)))) return fail(401, "unauthorized");
  const body = await readJson<{ setlist?: unknown }>(req);
  if (body?.setlist === undefined) return fail(400, "missing_setlist");
  if (JSON.stringify(body.setlist).length > 512 * 1024) return fail(413, "setlist_too_large");
  const parsed = SetlistSchema.safeParse(body.setlist);
  if (!parsed.success) return fail(400, "invalid_setlist");
  await saveSetlist(id, parsed.data);
  return ok({ saved: true });
}
