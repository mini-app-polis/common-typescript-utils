# ADR-003: Canonical API response envelope

Date: 2026-04-05

## Status

Accepted

## Context

Every internal API in the ecosystem returns JSON. Without a shared
response shape, each service picks its own conventions - one returns
bare data, another wraps in `{result: ...}`, another includes
pagination at the top level, another at `meta`. Consumers then need
per-service parsers, and schema evolution becomes a per-service
problem.

The ecosystem picked a specific shape at the outset:

- **Success**: `{data: T, meta: {version: "v1", ...}}` where `data`
  is the payload and `meta` carries versioning plus any
  service-specific metadata (counts, pagination cursors, timing).
- **Error**: `{error: {code: string, message: string}}` with a
  stable error-code vocabulary per service.
- Both envelopes are always present at the top level. No bare
  payloads, no conditional wrapping.

This library ships the TypeScript helpers that produce the success
envelope. Error envelopes are typically produced inline at the
throw site since each service has its own error-code vocabulary;
the helpers here focus on the common success case and list-case
with auto-populated `count`.

## Decision

Export `success<T>(data, meta?)` and `successList<T>(data, meta?)`
from `src/response.ts`. Both set `meta.version = "v1"` and return
the full envelope. `successList` additionally populates `meta.count`
from the array length.

Error response helpers are not exported. Services construct their
own `{error: {code, message}}` objects because error-code
vocabularies are per-service concerns.

The `version` field is a string literal `"v1"` - constant at the
library level. When the ecosystem evolves to a new envelope shape,
this constant changes in one place and all consumers pick up the
new version at their next library bump.

## Consequences

- Every TypeScript service that imports `success` or `successList`
  produces the canonical envelope shape by construction. Drift is
  prevented at the source rather than caught by linting or tests.
- The `meta.version` field is the single coordination point for
  envelope evolution. When a consumer wants to know "is this v1?",
  it checks `meta.version`. When we ship v2, the check becomes
  meaningful.
- Consumers using these helpers cannot accidentally omit `version`
  from `meta` - the helpers always include it, and the types would
  reject any attempt to override it to something other than `"v1"`.
- Error responses are not centralized in this library. The
  tradeoff: services have flexibility in their error-code vocabulary,
  but the consistency of `{error: {code, message}}` at the shape
  level is enforced only by convention and per-service tests. If
  the ecosystem grows enough to need shared error codes, adding an
  `error` helper here with a shared code enum is a later move.
- Pagination, sorting, and cursor metadata live in `meta` alongside
  `version`. Services define their own `meta` keys (e.g.
  `meta.total`, `meta.cursor`). No schema at the library level
  for `meta` beyond `version`; that's intentional - meta is the
  extensible field.
- The ecosystem's cross-stack API response rule in
  ecosystem-standards (XSTACK family) is implementable in
  TypeScript services via these helpers. The same rule on the
  Python side uses equivalent helpers in common-python-utils.
