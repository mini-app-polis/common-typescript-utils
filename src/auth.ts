export type ClerkPayload = {
  sub: string;
  email?: string;
} & Record<string, unknown>;

const CACHE_TTL_MS = 60 * 60 * 1000;

// Floor between forced JWKS refetches for one URL. An unknown `kid` triggers
// a refetch (see importKeyForKid), and an attacker can mint unlimited tokens
// carrying unknown kids, so without a floor that path turns every bad token
// into an outbound request to the identity provider.
const REFETCH_FLOOR_MS = 60 * 1000;

type Jwk = JsonWebKey & { kid?: string };
type JwkSet = { keys: Jwk[] };

const jwksCache = new Map<string, { jwks: JwkSet; fetchedAt: number }>();
const forcedRefetchAt = new Map<string, number>();
const keyCache = new Map<string, { key: CryptoKey; expiry: number }>();

function base64UrlDecode(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const json = new TextDecoder().decode(base64UrlDecode(parts[1]));
  return JSON.parse(json) as Record<string, unknown>;
}

async function fetchJwks(jwksUrl: string, force = false): Promise<JwkSet> {
  const now = Date.now();
  const cached = jwksCache.get(jwksUrl);
  if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.jwks;

  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as JwkSet;
  if (!jwks.keys?.length) throw new Error("No keys in JWKS");
  jwksCache.set(jwksUrl, { jwks, fetchedAt: now });
  return jwks;
}

async function importKeyForKid(jwksUrl: string, kid: string): Promise<CryptoKey> {
  const now = Date.now();
  const cached = keyCache.get(kid);
  if (cached && now < cached.expiry) return cached.key;

  let jwks = await fetchJwks(jwksUrl);
  let jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) {
    // An unknown kid means the key set moved on. Identity providers rotate
    // signing keys without notice, and the cached copy can be up to
    // CACHE_TTL_MS stale, so serving it back is how a rotation turns into an
    // hour of 401s on every authenticated request. Refetch once -- rate
    // limited, because unknown kids are also what a forged token looks like.
    // Floor on the forced refetch specifically, not on the last fetch of any
    // kind: a rotation usually lands while the cache is freshly warm, so
    // gating on cache age would block the one refetch that fixes it.
    const last = forcedRefetchAt.get(jwksUrl);
    if (last === undefined || now - last >= REFETCH_FLOOR_MS) {
      forcedRefetchAt.set(jwksUrl, now);
      jwks = await fetchJwks(jwksUrl, true);
      jwk = jwks.keys.find((k) => k.kid === kid);
    }
  }
  if (!jwk) throw new Error(`No JWK for kid ${kid}`);

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  keyCache.set(kid, { key, expiry: now + CACHE_TTL_MS });
  return key;
}

/**
 * Verify a Clerk session JWT.
 *
 * `expectedIssuer`, when given, is checked against the token's `iss`
 * claim. Without it a signature check alone proves only that *some*
 * issuer whose keys are in this JWKS signed the token — which is the
 * right answer for a single-tenant JWKS and the wrong one the moment a
 * key set serves more than one issuer, or a JWKS URL is misconfigured
 * to point at someone else's. Optional so existing callers keep
 * working, and every caller that knows its issuer should pass it.
 */
export async function verifyClerkToken(
  token: string,
  jwksUrl: string,
  expectedIssuer?: string
): Promise<ClerkPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]));
  const header = JSON.parse(headerJson) as { kid?: string; alg?: string };
  if (!header.kid) throw new Error("Token missing kid");

  const key = await importKeyForKid(jwksUrl, header.kid);
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecode(parts[2]);
  const sigBuf = new Uint8Array(signature.byteLength);
  sigBuf.set(signature);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBuf, signingInput);
  if (!valid) throw new Error("Invalid signature");

  const payload = decodePayload(token);
  const exp = payload.exp;
  if (typeof exp === "number" && Date.now() / 1000 >= exp) {
    throw new Error("Token expired");
  }
  if (expectedIssuer) {
    if (payload.iss !== expectedIssuer) {
      throw new Error("Untrusted issuer");
    }
  }
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) throw new Error("Invalid subject");

  const email =
    typeof payload.email === "string"
      ? payload.email
      : typeof (payload as { email_addresses?: { email_address?: string }[] }).email_addresses?.[0]
            ?.email_address === "string"
        ? (payload as { email_addresses: { email_address: string }[] }).email_addresses[0]
            .email_address
        : undefined;

  return { ...payload, sub, email };
}
