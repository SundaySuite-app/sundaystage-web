/**
 * GET /api/library — the signed-in operator's church song library.
 * Cookie-auth via the shared Sunday auth cookie (resolveSundayUser); NO bearer
 * secret, fully independent of any session. Not signed in → 401 (the operator
 * UI shows a "log in to see your church's library" CTA). Member of no church →
 * empty list. Reads are scoped to the church via the service role.
 */
import { ok, fail } from "@/lib/server/http";
import { resolveSundayUser } from "@/lib/server/sso";
import { listLibrarySongs } from "@/lib/server/library";

export async function GET(req: Request): Promise<Response> {
  const user = await resolveSundayUser();
  if (!user) return fail(401, "unauthorized");
  if (user.churchIds.length === 0) return ok({ songs: [], churchId: null });

  // MVP picks the first church; an explicit ?church_id= must be one the user
  // actually belongs to (never trust it blindly).
  const requested = new URL(req.url).searchParams.get("church_id");
  const churchId =
    requested && user.churchIds.includes(requested) ? requested : user.churchIds[0];

  const songs = await listLibrarySongs(churchId);
  return ok({ songs, churchId });
}
