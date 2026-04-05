export type ClerkPayload = {
  sub: string;
  email?: string;
} & Record<string, unknown>;

const CACHE_TTL_MS = 60 * 60 * 1000;

type Jwk = JsonWebKey & { kid?: string };
type JwkSet = { keys: Jwk[] };

let cache: { jwks: JwkSet; expiry: number } | null = null;
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

async function fetchJwks(jwksUrl: string): Promise<JwkSet> {
  const now = Date.now();
  if (cache && now < cache.expiry) return cache.jwks;

  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as JwkSet;
  if (!jwks.keys?.length) throw new Error("No keys in JWKS");
  cache = { jwks, expiry: now + CACHE_TTL_MS };
  return jwks;
}

async function importKeyForKid(jwksUrl: string, kid: string): Promise<CryptoKey> {
  const now = Date.now();
  const cached = keyCache.get(kid);
  if (cached && now < cached.expiry) return cached.key;

  const jwks = await fetchJwks(jwksUrl);
  const jwk = jwks.keys.find((k) => k.kid === kid);
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

export async function verifyClerkToken(token: string, jwksUrl: string): Promise<ClerkPayload> {
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
