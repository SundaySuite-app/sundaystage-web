import { describe, expect, it, beforeAll } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";
import { createVerifier, hasAppGrant, asGrantMap, asStringArray } from "@/lib/server/sundayAuth";

/**
 * A locally generated RS256 keypair fed through a JWKS — no network, no DB. We
 * sign with the private key and verify against the public set, exactly as prod
 * verifies against the Sunday platform's published JWKS.
 */
const AUD = "authenticated";
const ISS = "https://accounts.sunday.test";

let priv: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let kid: string;
let jwks: ReturnType<typeof createLocalJWKSet>;
let wrongJwks: ReturnType<typeof createLocalJWKSet>;

async function makeKeyset() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = crypto.randomUUID();
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { privateKey, getKey: createLocalJWKSet({ keys: [jwk] }), kid: jwk.kid };
}

beforeAll(async () => {
  const main = await makeKeyset();
  priv = main.privateKey;
  kid = main.kid;
  jwks = main.getKey;
  wrongJwks = (await makeKeyset()).getKey;
});

function sign(
  claims: Record<string, unknown>,
  opts: { aud?: string; iss?: string; expiresIn?: string; key?: typeof priv } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject((claims.sub as string) ?? "acct_1")
    .setIssuedAt()
    .setAudience(opts.aud ?? AUD)
    .setIssuer(opts.iss ?? ISS)
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.key ?? priv);
}

describe("createVerifier", () => {
  const verifier = () => createVerifier({ keys: jwks, audience: AUD, issuer: ISS });

  it("verifies a valid token and extracts the Sunday claims", async () => {
    const token = await sign({
      sub: "acct_42",
      church_ids: ["ch_1", "ch_2"],
      app_grants: { ch_1: ["stage", "song"], ch_2: ["plan"] },
    });
    const claims = await verifier()(token);
    expect(claims.sub).toBe("acct_42");
    expect(claims.church_ids).toEqual(["ch_1", "ch_2"]);
    expect(claims.app_grants).toEqual({ ch_1: ["stage", "song"], ch_2: ["plan"] });
  });

  it("coerces scalar church_ids → array and missing/malformed app_grants → {}", async () => {
    const claims = await verifier()(await sign({ sub: "a", church_ids: "ch_solo" }));
    expect(claims.church_ids).toEqual(["ch_solo"]);
    expect(claims.app_grants).toEqual({});

    const claims2 = await verifier()(
      await sign({ sub: "b", app_grants: { ch_1: ["stage", 5], bad: "nope" } }),
    );
    expect(claims2.app_grants).toEqual({ ch_1: ["stage"] });
  });

  it("rejects expired / wrong-key / wrong-aud / wrong-iss / garbage tokens", async () => {
    await expect(verifier()(await sign({ sub: "a" }, { expiresIn: "-1m" }))).rejects.toThrow();
    const wrong = createVerifier({ keys: wrongJwks, audience: AUD, issuer: ISS });
    await expect(wrong(await sign({ sub: "a" }))).rejects.toThrow();
    await expect(verifier()(await sign({ sub: "a" }, { aud: "other" }))).rejects.toThrow();
    await expect(
      verifier()(await sign({ sub: "a" }, { iss: "https://evil.example" })),
    ).rejects.toThrow();
    await expect(verifier()("not-a-jwt")).rejects.toThrow();
  });

  it("rejects a token with no subject", async () => {
    // sub:"" → SignJWT.setSubject still runs, verifier must reject empty sub.
    await expect(verifier()(await sign({ sub: "" }))).rejects.toThrow();
  });
});

describe("claim coercion helpers", () => {
  it("asStringArray", () => {
    expect(asStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(asStringArray("solo")).toEqual(["solo"]);
    expect(asStringArray(undefined)).toEqual([]);
  });
  it("asGrantMap drops malformed entries", () => {
    expect(asGrantMap({ c1: ["stage", 5], bad: "x" })).toEqual({ c1: ["stage"] });
    expect(asGrantMap(["stage"])).toEqual({});
    expect(asGrantMap(null)).toEqual({});
  });
});

describe("hasAppGrant", () => {
  const claims = { sub: "u", church_ids: ["c1"], app_grants: { c1: ["stage", "rec"] }, raw: {} };
  it("is true only for a granted app in that church", () => {
    expect(hasAppGrant(claims, "c1", "stage")).toBe(true);
    expect(hasAppGrant(claims, "c1", "plan")).toBe(false);
    expect(hasAppGrant(claims, "c2", "stage")).toBe(false);
  });
});
