# common-typescript-utils

Shared TypeScript utilities for the MiniAppPolis ecosystem. The TypeScript counterpart to [`common-python-utils`](https://github.com/mini-app-polis/common-python-utils).

## Installation

```bash
npm install common-typescript-utils
```

## Modules

### `createLogger(service)`

Structured logger with dev/prod modes. In production emits JSON to stdout/stderr; in development emits emoji-prefixed human-readable lines.

```typescript
import { createLogger } from "common-typescript-utils";

const logger = createLogger("my-service");

logger.info({ event: "server_started", category: "infra", context: { port: 3000 } });
logger.error({ event: "db_failure", category: "data", error: new Error("timeout") });
logger.start("initializing");   // 🚀 in dev, INFO JSON in prod
logger.success("ready");        // ✅ in dev, INFO JSON in prod
logger.failure("crashed");      // ❌ in dev, ERROR JSON in prod
```

Log categories: `"infra" | "pipeline" | "data" | "api"`

### `verifyClerkToken(token, jwksUrl)`

Raw JWKS + RS256 JWT verification using the Web Crypto API. Runtime-agnostic — works in Node 18+, Cloudflare Workers, and Deno without any polyfills.

```typescript
import { verifyClerkToken } from "common-typescript-utils";

const payload = await verifyClerkToken(token, "https://your-clerk-instance.clerk.accounts.dev/.well-known/jwks.json");
// payload.sub — owner_id
// payload.email — resolved from email or email_addresses
```

JWKS responses and imported keys are cached in-memory with a 1-hour TTL.

### `success` / `successList` / `error` / `CommonErrors`

Standard API response envelopes.

```typescript
import { success, successList, CommonErrors } from "common-typescript-utils";

return c.json(success({ id: 1, name: "foo" }));
// { data: { id: 1, name: "foo" }, meta: { version: "v1" } }

return c.json(successList(items), 200);
// { data: [...], meta: { version: "v1", count: 3 } }

return c.json(CommonErrors.notFound("User"), 404);
// { error: { code: "NOT_FOUND", message: "User not found" } }
```

Available helpers: `unauthorized()`, `forbidden()`, `notFound(resource?)`, `badRequest(message)`, `internalError(message?)`, `validationError(zodIssues)`.

### Schemas

Generic Zod schemas for common API patterns.

```typescript
import { PaginationSchema, IdParamSchema, UserRoleSchema } from "common-typescript-utils";

const { page, limit } = PaginationSchema.parse(req.query);
const { id } = IdParamSchema.parse(req.params);
const role = UserRoleSchema.parse(req.body.role); // "user" | "admin"
```

> **Note:** Domain-specific schemas (WCS divisions, session/checkin status, etc.) live in the repos that own those domains.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Release

Releases are automated via semantic-release on push to `main`. Requires `NPM_TOKEN` and `GITHUB_TOKEN` secrets.

```
feat:     → minor bump
fix:      → patch bump
feat!:    → major bump
```
