# ADR-001: Web Crypto for Clerk JWT verification

Date: 2026-04-05

## Status

Accepted

## Context

This library provides the TypeScript side of Project Keystone -
verification of Clerk-issued machine-to-machine JWTs presented by
cogs to internal APIs. The verification logic needs to fetch Clerk's
JWKS, cache it, look up the key identified by the token's `kid`,
and verify the token's signature.

Three implementation paths were available:

- **Node `crypto` module.** Ships with Node. Direct and fast. But
  Node-only - any service running under Cloudflare Workers (including
  every Worker-based Astro SSR site and any future edge-deployed
  service) cannot import from `node:crypto`.
- **`@clerk/backend` SDK.** Clerk's official Node SDK. Handles
  JWKS fetch, caching, and verification. Opinionated runtime
  assumptions; its current packaging doesn't cleanly support the
  Cloudflare Workers runtime without shims or forks.
- **Web Crypto API.** The browser-standard `crypto.subtle` surface,
  also available in Node >= 16 and in Cloudflare Workers natively.
  Lower-level than `@clerk/backend` - we have to implement JWKS
  fetch, caching, base64url decoding, and verification ourselves.

The ecosystem has services on both runtimes:

- **Node/Hono services** - api-kaianolevine-com, deejaytools-com-api.
  These could use either Node crypto or Web Crypto.
- **Cloudflare Workers SSR** - website-astro-software, website-astro-wcs,
  website-astro-kaianolevine, any future edge-deployed consumer.
  These can only use Web Crypto.

A library that imports `node:crypto` silently excludes the Workers
consumers. A library that ships Web Crypto runs on both runtimes
without conditional code paths.

## Decision

Implement Clerk JWT verification using the Web Crypto API
(`crypto.subtle`, `atob`, `TextDecoder`, `JsonWebKey`, `CryptoKey`).
JWKS is fetched via `fetch()`, cached in-module with a TTL, and
individual keys are imported via `crypto.subtle.importKey()`.

No dependency on `node:crypto`, no dependency on `@clerk/backend`.
The only runtime dependency is `zod` (used by `schemas.ts`), plus
Web Crypto and `fetch` - both universally available.

## Consequences

- The library runs unchanged on Node and Cloudflare Workers. Every
  ecosystem consumer can depend on it regardless of runtime.
- We own the JWKS caching, key lookup, and signature verification
  code. That's ~90 lines in `src/auth.ts` - small enough to audit
  and test directly.
- When Clerk rotates keys or changes JWKS behavior, the response
  here is a code change in this library rather than an SDK bump.
  That cost is real but bounded; Clerk's JWKS surface is stable.
- Node consumers pay a small performance cost versus using
  `node:crypto` directly. In practice M2M tokens are verified
  once per request; the overhead is negligible.
- Worker consumers get Clerk auth support they otherwise could
  not have without forking or shimming `@clerk/backend`. This is
  the primary reason for the decision.
- Future Clerk features (revocation, session introspection) that
  only ship in `@clerk/backend` would require us to implement them
  ourselves or add a parallel Node-only code path. If we hit a
  feature the SDK provides and Web Crypto can't reach, revisit
  this decision - but expect the answer to still be "implement it
  ourselves, keep the cross-runtime guarantee."
