# ADR-002: Logger interface mirrors common-python-utils

Date: 2026-04-05

## Status

Accepted

## Context

The MiniAppPolis ecosystem has a three-layer observability standard:
Healthchecks.io liveness, structured logs, and Sentry error tracking.
The structured-logs layer needs a uniform shape across services so
logs from different cogs and runtimes aggregate cleanly.

The Python library (`common-python-utils`) already shipped a
structured logger with a specific contract:

- Log levels: DEBUG, INFO, WARN, ERROR.
- Categories: `infra`, `pipeline`, `data`, `api` - a fixed taxonomy
  for what kind of event is being logged.
- Each log call takes `{event, category, context}` as structured
  parameters, not a formatted string.
- Convenience methods `start()`, `success()`, `failure()` for flow
  lifecycle events.

A TypeScript logger for the same ecosystem had three options:

- **Copy the Python interface verbatim.** Uniform log shape across
  runtimes. New TypeScript code uses a familiar API if the developer
  has Python context. One mental model.
- **Design a TypeScript-idiomatic interface.** Use the conventions
  the JavaScript ecosystem expects (pino, winston, console-like).
  Better onboarding for TypeScript-first contributors, but logs
  don't aggregate cleanly with Python-side logs.
- **Wrap an existing TypeScript logger** (pino, winston). Less code
  here but adds a dependency and surfaces pino/winston-specific
  behavior to consumers.

The observability value comes from aggregation. A log search for
`category=pipeline severity=ERROR` should return results from every
service regardless of language. That requires a shared shape.

## Decision

Mirror the common-python-utils logger interface in TypeScript. Same
level names, same category taxonomy, same `{event, category, context}`
parameters, same lifecycle methods (`start`, `success`, `failure`).

The implementation is a thin wrapper around `console.log` with
JSON-structured output in production and human-readable output in
development (toggled by `NODE_ENV`). No dependency on pino or
winston.

## Consequences

- Log search across runtimes works with a single query shape.
  Pipeline Health views and log aggregation tooling see uniform
  records from Python cogs and TypeScript services alike.
- TypeScript developers unfamiliar with the Python conventions have
  to learn the ecosystem's log taxonomy. This is a modest cost paid
  once per developer; the categories are short and map cleanly to
  the kinds of code each describes.
- The logger is intentionally simple - no log streams, no sinks,
  no sampling, no structured destinations. Production logs go to
  stdout and get ingested downstream. If that downstream layer
  needs to grow (e.g. ship logs to Postgres for querying, per
  memory's "structured log observability" backlog), the change
  lands in a downstream shipper, not here.
- Adding a new log category requires coordinated changes in both
  libraries and any active consumer using the new category. The
  four existing categories (`infra`, `pipeline`, `data`, `api`)
  have covered all ecosystem use cases to date. Broadening
  carefully is the discipline.
- The logger does not integrate directly with Sentry. That's
  intentional - Sentry captures unhandled exceptions via its own
  `sentry_sdk.init()` hook (Node side) or Sentry Workers SDK (edge
  side); the logger is for the middle tier of structured-log
  observability, not for error capture.
