/**
 * POST /api/sessions — create a network-display session.
 * Body: { origin: "desktop" | "web", title? }
 * Returns { id, code, secret } — the SECRET IS RETURNED EXACTLY ONCE.
 * If the caller is signed in to a Sunday account (shared .sundaysuite.app
 * SSO cookie), the session is tagged with their church for provenance.
 */
import { ok, readJson } from "@/lib/server/http";
import { createSession } from "@/lib/server/sessions";
import { resolveChurchId } from "@/lib/server/sso";

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<{ origin?: string; title?: string }>(req);
  const origin = body?.origin === "desktop" ? "desktop" : "web";
  const title = typeof body?.title === "string" ? body.title.slice(0, 120) : "";

  const churchId = await resolveChurchId();
  const session = await createSession({ origin, title, churchId });
  return ok(session, { status: 201 });
}
