import type { CookieOptions } from "@supabase/ssr";

/**
 * Shared cookie options so the Supabase session cookie is written identically
 * everywhere. When NEXT_PUBLIC_COOKIE_DOMAIN is set (e.g. `.sundaysuite.app`),
 * the cookie is scoped to the parent domain so every Sunday web app shares one
 * login — sign in on plan./song./stage., you're signed in on all. Unset in
 * local dev (localhost has no parent to share to). Mirrors SundayPlan.
 */
export function sharedCookieOptions(): CookieOptions {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  if (!domain) return {};
  return { domain, path: "/", sameSite: "lax", secure: true };
}
