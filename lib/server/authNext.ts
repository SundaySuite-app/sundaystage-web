/**
 * Whitelist for the OAuth callback's post-login redirect (`?next=`).
 *
 * The callback is the only auth-WRITING surface, so its redirect target is a
 * juicy open-redirect / cookie-theft vector if taken from the URL unchecked.
 * Pure + unit-tested: we accept ONLY the two destinations the app ever sends a
 * freshly-signed-in operator to — the library and the landing page. Anything
 * else (other paths, absolute/protocol-relative URLs, backslash tricks) falls
 * back to /library.
 */

/** The only redirect targets the callback will honour after sign-in. */
export const ALLOWED_NEXT = ["/library", "/"] as const;

const DEFAULT_NEXT = "/library";

/** Resolve a requested `next` to a safe, whitelisted in-app path. */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  // Reject anything that isn't a clean same-origin path before whitelisting:
  // no protocol-relative `//host`, no `\` smuggling, no embedded scheme.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return DEFAULT_NEXT;
  }
  return (ALLOWED_NEXT as readonly string[]).includes(next) ? next : DEFAULT_NEXT;
}
