/**
 * GET /api/sessions/by-code/<pin> — display/follow join. Resolves a live
 * session and hands the late-joiner the current frame immediately.
 */
import { ok, fail, rateLimit, clientIp } from "@/lib/server/http";
import { getByCode } from "@/lib/server/sessions";
import { isValidPin } from "@/lib/codes";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidPin(code)) return fail(400, "invalid_code");
  // Join is unauthenticated and the PIN space is only 10^6 — throttle
  // per-IP guessing. Legit displays join once (plus rare reconnects).
  if (!rateLimit(`join:${clientIp(req)}`, 30, 60_000))
    return fail(429, "rate_limited");
  const session = await getByCode(code);
  if (!session) return fail(404, "not_found");
  return ok({
    id: session.id,
    title: session.title,
    origin: session.origin,
    status: session.status,
    seq: session.current_seq,
    frame: session.current_frame,
  });
}
