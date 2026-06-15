import "server-only";

/**
 * Sunday-account Bearer JWT validation against the platform JWKS — used only by
 * the desktop → cloud library publish endpoint (the operator's library *read*
 * uses the shared auth cookie via lib/server/sso.ts instead).
 *
 * The verifier and claim shape mirror the prod-validated SundaySong middleware
 * (`sundaysong/apps/api/src/middleware/auth.ts`) and `@sunday/auth-client`:
 *   - `sub`         the Sunday account id
 *   - `church_ids`  churches this account may act for
 *   - `app_grants`  per-church enabled apps, `{ "<church_id>": ["stage","rec"] }`
 *     (the EXACT per-church map the SundayPlan custom_access_token_hook stamps).
 *
 * Config-gated: production resolves keys via a remote JWKS over HTTPS
 * (`createRemoteJWKSet`), pinned by SUNDAY_JWKS_URL + SUNDAY_AUTH_AUDIENCE
 * (+ optional SUNDAY_AUTH_ISSUER). When unset, verifyBearer returns null and the
 * publish route FAILS CLOSED (a write endpoint must never accept anonymous
 * writes). The pure `createVerifier` is unit-tested against a local key set.
 *
 * NETWORK-UNVERIFIED: the remote JWKS fetch compiles + runs on the Workers
 * runtime (jose is WebCrypto-based) but cannot be exercised here.
 */
import {
  jwtVerify,
  errors,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";

export interface SundayClaims {
  sub: string;
  church_ids: string[];
  app_grants: Record<string, string[]>;
  raw: JWTPayload;
}

/** Normalise a claim that may be a string, an array, or absent into string[]. */
export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

/** Normalise `app_grants` into a per-church map, defensively (missing/malformed → {}). */
export function asGrantMap(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [church, apps] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(apps)) {
        out[church] = apps.filter((x): x is string => typeof x === "string");
      }
    }
  }
  return out;
}

export interface VerifierOptions {
  keys: JWTVerifyGetKey | KeyLike | Uint8Array;
  /** Expected audience (`aud`). Required — an unscoped token is rejected. */
  audience: string;
  /** Expected issuer (`iss`), when pinned. */
  issuer?: string;
}

export type Verifier = (bearerToken: string) => Promise<SundayClaims>;

/**
 * Build a verifier from an injected key set. Asymmetric only — ES256 (what
 * Supabase signs new projects with) or RS256; any other algorithm (notably
 * symmetric HS256) is rejected rather than silently trusted. Pure aside from
 * the crypto verify, so it's fully unit-testable with a local key.
 */
export function createVerifier(opts: VerifierOptions): Verifier {
  return async (bearerToken: string): Promise<SundayClaims> => {
    const { payload } = await jwtVerify(
      bearerToken,
      opts.keys as Parameters<typeof jwtVerify>[1],
      {
        algorithms: ["ES256", "RS256"],
        audience: opts.audience,
        ...(opts.issuer ? { issuer: opts.issuer } : {}),
      },
    );
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new errors.JWTClaimValidationFailed("missing subject", payload, "sub", "check_failed");
    }
    return {
      sub: payload.sub,
      church_ids: asStringArray((payload as Record<string, unknown>).church_ids),
      app_grants: asGrantMap((payload as Record<string, unknown>).app_grants),
      raw: payload,
    };
  };
}

/** Whether the claims carry `app` for `churchId` (e.g. the "stage" grant). */
export function hasAppGrant(claims: SundayClaims, churchId: string, app: string): boolean {
  return (claims.app_grants[churchId] ?? []).includes(app);
}

// ── Config-gated remote verifier (production) ────────────────────────────────

let cached: Verifier | null | undefined;

/** True once the platform JWKS + audience are configured (enforcement on). */
export function isAuthConfigured(): boolean {
  return !!(process.env.SUNDAY_JWKS_URL && process.env.SUNDAY_AUTH_AUDIENCE);
}

function configuredVerifier(): Verifier | null {
  if (cached !== undefined) return cached;
  const jwksUrl = process.env.SUNDAY_JWKS_URL;
  const audience = process.env.SUNDAY_AUTH_AUDIENCE;
  if (!jwksUrl || !audience) {
    cached = null;
    return cached;
  }
  const keys = createRemoteJWKSet(new URL(jwksUrl));
  cached = createVerifier({ keys, audience, issuer: process.env.SUNDAY_AUTH_ISSUER });
  return cached;
}

/**
 * Verify a Bearer token via the configured remote JWKS.
 * Returns null when auth isn't configured OR the token is invalid; callers
 * should check `isAuthConfigured()` first to distinguish 503 from 401.
 */
export async function verifyBearer(token: string): Promise<SundayClaims | null> {
  const verify = configuredVerifier();
  if (!verify) return null;
  try {
    return await verify(token);
  } catch {
    return null;
  }
}
