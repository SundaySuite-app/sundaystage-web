/**
 * OAuth callback — `/auth/callback`. Exchanges the `?code=` for a session (sets
 * the shared `.sundaysuite.app` auth cookie) and forwards to a safe `next`.
 * This is the ONLY auth-writing surface; display/follow/scene/operator-join
 * never touch it. Mirrors the SundayPlan callback, minus church onboarding.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createWriteClient } from "@/lib/supabase/server-write";

export const dynamic = "force-dynamic";

/** Only allow same-origin relative redirects (no protocol-relative `//host`). */
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/library";
  return next;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      new URL(`/library?error=${encodeURIComponent(providerError)}`, origin),
    );
  }

  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/library?error=missing_code", origin));

  const next = sanitizeNext(searchParams.get("next"));
  const supabase = await createWriteClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/library?error=exchange_failed", origin));

  return NextResponse.redirect(new URL(next, origin));
}
