/**
 * POST /api/sessions/import-serviceplan — create a network-display session from
 * a canonical SundayPlan `ServicePlan` (the Plan → Stage bridge). The body is a
 * ServicePlan JSON; the running order becomes a pre-seeded setlist skeleton so
 * the operator opens `/o/<id>` with the service already laid out.
 *
 * Returns { id, code, secret } — the SECRET IS RETURNED EXACTLY ONCE, same as
 * POST /api/sessions. Provenance church is stamped from the SSO cookie when
 * signed in; the plan's own church_id is never trusted for that.
 */
import { ServicePlan } from "@sunday/contracts";

import { fail, ok, readJson } from "@/lib/server/http";
import { servicePlanToSlides } from "@/lib/serviceplan";
import { createSession } from "@/lib/server/sessions";
import { resolveChurchId } from "@/lib/server/sso";
import { SetlistSchema } from "@/lib/setlist";

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const parsed = ServicePlan.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_serviceplan");

  const plan = parsed.data;
  const slides = servicePlanToSlides(plan);

  // Reuse the exact guard the setlist PUT applies (slide/line/label caps), so an
  // oversized plan is rejected the same way rather than truncated silently.
  const setlist = SetlistSchema.safeParse({
    slides,
    current: slides.length > 0 ? 0 : -1,
  });
  if (!setlist.success) return fail(422, "serviceplan_too_large");

  const churchId = await resolveChurchId();
  const title = plan.service.name.slice(0, 120);
  const session = await createSession({
    origin: "web",
    title,
    churchId,
    setlist: setlist.data,
  });
  return ok(session, { status: 201 });
}
