# Playbook: publishing a TypeScript package to npm

This is the canonical reference for how the fleet's TypeScript libraries
authenticate when they publish, what the failure modes look like, and how
to get out of each one.

It exists because npm removed non-expiring tokens in November 2025. Every
credential on this path now has a deadline, so this failure is not an
incident — it is a scheduled event, and the only question is whether the
next person recognises it in two minutes or two hours.

Python libraries are not in scope here, but no longer for the reason this
section used to give. They are published to PyPI as of September 2026, over
trusted publishing rather than a stored token — see
`common-python-utils/docs/pypi-package-publishing.md`. The exclusion logic
in `mini-app-polis/.github` `security.yml` still assumes they are not
published and needs revisiting.

---

## §1 — How it works today

`common-typescript-utils` is the only TypeScript library on this path.

```
  GitHub Actions release job
    └─ dopplerhq/secrets-fetch-action  → injects NPM_TOKEN into $GITHUB_ENV
    └─ actions/setup-node              → writes _temp/.npmrc with
                                          //registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
    └─ npx semantic-release
         └─ @semantic-release/npm verifyConditions → npm whoami
         └─ @semantic-release/npm publish          → npm publish
```

Two things follow from this shape, and both matter when it breaks:

- **`whoami` runs before `publish`.** semantic-release verifies identity
  as a precondition. A credential that can publish but cannot answer
  `whoami` fails the whole run without ever attempting a publish.
- **The token passes through two systems.** Doppler holds it, GitHub
  injects it. A fault in either presents at npm, which is the wrong place
  to look.

---

## §2 — Reading the failure

| Symptom | Cause | Go to |
|---|---|---|
| `NPM_TOKEN is empty after the Doppler step` | Secret missing, renamed, or `DOPPLER_TOKEN` itself expired | §3 |
| `401 Unauthorized - GET /-/whoami` | Token expired, revoked, or wrongly scoped | §4 |
| `EINVALIDNPMTOKEN` | Always downstream of the 401 above. Not a separate fault. | §4 |
| `403 Forbidden - PUT ...` naming `bypass 2fa` | Token authenticates but lacks **Bypass 2FA**. `whoami` passes; only the final publish is refused. | §5 |
| `Variable $owner of type String! was provided invalid value` | `@semantic-release/github`'s *fail* handler crashing while filing an issue about the real error | ignore |

That last row costs people time. It appears **last** in the log, where
the eye expects the root cause, and it is noise. Read upward to the first
`✘`.

The release job checks `NPM_TOKEN` for presence before the build so that
the empty case and the invalid case stop looking identical. An empty
secret otherwise surfaces as an npm auth error, which sends you to
npmjs.com when the problem is in Doppler.

---

## §3 — Doppler is not supplying the secret

Confirm what Doppler actually holds:

```bash
doppler secrets get NPM_TOKEN --plain \
  --project mini-app-polis-ecosystem --config prd | wc -c
```

Zero means the key is absent or renamed. The workflow reads exactly
`NPM_TOKEN` from project `mini-app-polis-ecosystem`, config `prd`; all
three must match. If the CLI itself fails to authenticate, the repo's
`DOPPLER_TOKEN` GitHub secret has expired and that is the actual fix.

---

## §4 — Rotating the npm token

npm removed legacy tokens in November 2025. Granular access tokens are
the only kind, and all of them expire.

Create at npmjs.com → **Access Tokens** → **Generate New Token**:

| Field | Value | Why |
|---|---|---|
| Name | `<package>-release` | Identifies it at rotation time |
| Expiration | The longest offered; record the date | There is no non-expiring option |
| Bypass 2FA | **On — required** | Verified 2026-09-04: without it, `publish` returns 403 even though `whoami` succeeds. See §5. |
| IP Allowlist | **Empty** | GitHub runners have dynamic IPs. An allowlist here fails intermittently and reads as an auth bug. |
| Packages & Scopes | *Only select packages* → the one package, **Read and write** | Write is required to publish. Never grant "All packages". |
| Organizations | **No access** | Org permissions cover org settings, teams and users only — they play no part in publishing. |

Verify before storing it, because the round trip through CI is slow and
the error it produces is ambiguous:

```bash
printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > /tmp/npmrc
npm whoami --userconfig /tmp/npmrc    # exactly what verifyConditions runs
rm /tmp/npmrc
```

Your username means the token satisfies semantic-release. Then store it
in Doppler under `NPM_TOKEN`, project `mini-app-polis-ecosystem`, config
`prd`.

---

## §5 — Bypass 2FA is required; `whoami` is not affected

**Settled 2026-09-04 by a live release run.**

npm's documentation states:

> Starting August 2026, the Bypass 2FA setting does not apply to
> account-identity or account-governance actions. Those actions always
> require an interactive 2FA challenge.

That raised a reasonable worry, since `@semantic-release/npm` calls
`npm whoami` before publishing: if `whoami` counted as an account-identity
action, no token would clear `verifyConditions` on a 2FA account. **It
does not.** Both halves were observed directly:

- **`npm whoami` succeeds** with a granular token that does *not* have
  Bypass 2FA. `verifyConditions` completed and printed the account name.
- **`npm publish` is refused without it:**

  ```
  403 Forbidden - PUT https://registry.npmjs.org/<package>
  Two-factor authentication or granular access token with bypass 2fa
  enabled is required to publish packages.
  ```

So on an account with 2FA enabled, Bypass 2FA is **mandatory for this
flow**, not conditional on anything. The August 2026 restriction does not
reach it.

Worth knowing how late this fails. `whoami` passes, commits are analysed,
the next version is computed, the package is built and packed — and only
the final `PUT` is rejected. A token missing this one checkbox looks
completely healthy until the last second of the release, and the 401 and
403 paths are easy to conflate because both read as "token problem."

---

## §6 — Trusted publishing (the exit)

npm's own recommendation for CI is trusted publishing: GitHub Actions
authenticates over OIDC with short-lived credentials, and no npm token
exists at all. It removes the rotation schedule, removes `NPM_TOKEN` from
Doppler, and sidesteps §5 entirely, since there is no token for the 2FA
setting to apply to.

Requirements, and the fleet's position on each:

| Requirement | Status in `common-typescript-utils` |
|---|---|
| `id-token: write` on the job | Already present |
| `setup-node` with `registry-url` | Already present |
| Node ≥ 22.14.0 | On Node 22 — pin the minor before relying on it |
| npm CLI ≥ 11.5.1 | Unverified; runner default may be older |
| Trusted publisher configured on npmjs.com | Not done — package settings → Trusted Publisher → GitHub Actions, then org, repo, and the exact workflow filename |

**Open question:** whether `@semantic-release/npm` works under OIDC.
npm's CLI detects OIDC from the environment, and semantic-release shells
out to `npm publish`, so it should — but that has not been demonstrated
here and "should" is doing real work in that sentence.

Sequence it so a failure costs nothing: rotate the token first, configure
trusted publishing separately, confirm a release completes with
`NODE_AUTH_TOKEN` removed, and only then delete the Doppler secret.

---

## §7 — The alternative not taken

Dropping npm entirely and consuming the library by git ref was considered
and rejected in September 2026, when `common-typescript-utils` had exactly
one consumer.

The reasoning worth preserving: dropping the registry does not remove the
credential, it **moves** it. Publishing to a public package needs a
token; consuming one needs nothing. A private git dependency inverts
that — publishing needs only `GITHUB_TOKEN`, but every consumer's CI
needs cross-repo read access, which `GITHUB_TOKEN` does not grant. One
publish-side secret becomes N consume-side secrets. At one consumer that
is a wash; it gets worse as consumers are added, which is the direction
the fleet is going.

Revisit if the count of TypeScript libraries grows enough that
per-library token rotation becomes the dominant cost, or if the fleet
moves to a monorepo where the question dissolves.

**Related and still open:** the repo is private, but the npm package is
public and unscoped. Anything published is readable by anyone. That was
never a decision, only a default, and it should become one.
