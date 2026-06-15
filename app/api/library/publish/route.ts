/**
 * POST /api/library/publish — the desktop app publishes its library here (the
 * one-way desktop → cloud write path). Bearer-authed with a Sunday access token
 * (JWKS-verified); the church is taken from the TOKEN claims, never trusted from
 * the body alone, and the caller must hold the "stage" app-grant for it.
 *
 * Fails CLOSED: if Sunday auth isn't configured (SUNDAY_JWKS_URL / _AUDIENCE),
 * this write endpoint returns 503 rather than accepting anonymous writes.
 *
 * 503 auth not configured · 401 missing/invalid token · 400 bad body ·
 * 403 church not granted / missing stage grant.
 */
import { ok, fail, readJson, bearer } from "@/lib/server/http";
import { isAuthConfigured, verifyBearer, hasAppGrant } from "@/lib/server/sundayAuth";
import { PublishBody, publishLibrary } from "@/lib/server/library";

const STAGE_APP = "stage";

export async function POST(req: Request): Promise<Response> {
  if (!isAuthConfigured()) return fail(503, "auth_not_configured");

  const token = bearer(req);
  if (!token) return fail(401, "unauthorized");
  const claims = await verifyBearer(token);
  if (!claims) return fail(401, "unauthorized");

  const parsed = PublishBody.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "invalid_body");
  const { church_id, songs, deleted } = parsed.data;

  // Church scope + app grant come from the verified token, not the body.
  if (!claims.church_ids.includes(church_id)) return fail(403, "church_not_granted");
  if (!hasAppGrant(claims, church_id, STAGE_APP)) return fail(403, "app_not_granted");

  try {
    const result = await publishLibrary(church_id, songs, deleted ?? []);
    return ok(result);
  } catch {
    return fail(500, "publish_failed");
  }
}
