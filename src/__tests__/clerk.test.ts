import { describe, it, expect, vi, afterEach } from "vitest";

// A fresh kid per token. The module caches an imported key by kid for an
// hour, so reusing one across tests verifies the second token against the
// first token's key and every assertion becomes "Invalid signature".
let kidSeq = 0;
const nextKid = () => `test-kid-${++kidSeq}`;
const JWKS_URL = "https://clerk.test/.well-known/jwks.json";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Mint a real RS256 token and the JWKS that verifies it. */
async function mint(claims: Record<string, unknown>) {
  const kid = nextKid();
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const header = b64urlJson({ alg: "RS256", kid, typ: "JWT" });
  const payload = b64urlJson(claims);
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, signingInput)
  );
  return {
    token: `${header}.${payload}.${b64url(sig)}`,
    jwks: { keys: [{ ...jwk, kid }] },
  };
}

/**
 * Stub the JWKS fetch and hand back a *fresh* module instance.
 *
 * auth.ts caches the fetched JWKS by URL and each imported key by kid for
 * an hour, both at module scope. Without resetting the module every test
 * after the first verifies against the first test's key and fails as
 * "Invalid signature" — an artefact of the cache, not of the assertion.
 */
async function freshVerifier(jwks: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => jwks }) as unknown as Response)
  );
  vi.resetModules();
  return (await import("../auth.js")).verifyClerkToken;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe("verifyClerkToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a well-formed token and returns its subject", async () => {
    const { token, jwks } = await mint({ sub: "user_1", exp: future(), iss: "https://clerk.test" });
    const verifyClerkToken = await freshVerifier(jwks);
    const payload = await verifyClerkToken(token, JWKS_URL);
    expect(payload.sub).toBe("user_1");
  });

  it("accepts a token whose issuer matches the expected one", async () => {
    const { token, jwks } = await mint({ sub: "user_1", exp: future(), iss: "https://clerk.test" });
    const verifyClerkToken = await freshVerifier(jwks);
    const payload = await verifyClerkToken(token, JWKS_URL, "https://clerk.test");
    expect(payload.sub).toBe("user_1");
  });

  it("rejects a validly signed token from a different issuer", async () => {
    // The case a signature check alone cannot catch: the token is
    // genuinely signed by a key in this JWKS, so without an issuer
    // check it is indistinguishable from one of ours.
    const { token, jwks } = await mint({ sub: "user_1", exp: future(), iss: "https://someone-else.test" });
    const verifyClerkToken = await freshVerifier(jwks);
    await expect(verifyClerkToken(token, JWKS_URL, "https://clerk.test")).rejects.toThrow(
      /Untrusted issuer/
    );
  });

  it("rejects a token with no issuer claim when one is expected", async () => {
    const { token, jwks } = await mint({ sub: "user_1", exp: future() });
    const verifyClerkToken = await freshVerifier(jwks);
    await expect(verifyClerkToken(token, JWKS_URL, "https://clerk.test")).rejects.toThrow(
      /Untrusted issuer/
    );
  });

  it("rejects an expired token", async () => {
    const { token, jwks } = await mint({ sub: "user_1", exp: Math.floor(Date.now() / 1000) - 1 });
    const verifyClerkToken = await freshVerifier(jwks);
    await expect(verifyClerkToken(token, JWKS_URL)).rejects.toThrow(/expired/i);
  });

  it("rejects a tampered payload", async () => {
    const { token, jwks } = await mint({ sub: "user_1", exp: future() });
    const verifyClerkToken = await freshVerifier(jwks);
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64urlJson({ sub: "admin", exp: future() })}.${s}`;
    await expect(verifyClerkToken(forged, JWKS_URL)).rejects.toThrow(/Invalid signature/);
  });

  it("rejects a malformed token", async () => {
    const verifyClerkToken = await freshVerifier({ keys: [] });
    await expect(verifyClerkToken("not.a.jwt.really", JWKS_URL)).rejects.toThrow(/Malformed/);
  });
});
