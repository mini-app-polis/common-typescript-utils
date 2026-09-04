# Playbook: publishing a TypeScript package to npm

This is the canonical reference for how the fleet's TypeScript libraries
authenticate when they publish, what the failure modes look like, and how
to get out of each one.

It exists because npm removed non-expiring tokens in November 2025. Every
credential on this path now has a deadline, so this failure is not an
incident — it is a scheduled event, and the only question is whether the
next person recognises it in two minutes or two hours.

Python libraries are not in scope. They are pulled from git and never
published to PyPI, so they have no registry credential at all. See the
exclusion logic in `mini-app-polis/.github` `security.yml`.

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
| `401 Unauthorized - GET /-/whoami` | Token expired, revoked, wrongly scoped — or the 2FA interaction in §5 | §4 |
| `EINVALIDNPMTOKEN` | Always downstream of the 401 above. Not a separate fault. | §4 |
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
| Bypass 2FA | On, if 2FA is enabled on the account or package | semantic-release cannot answer an interactive challenge. Read §5 first. |
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

## §5 — The Bypass 2FA caveat

**Unconfirmed. Check it before assuming a rotation will help.**

npm's documentation states:

> Starting August 2026, the Bypass 2FA setting does not apply to
> account-identity or account-governance actions. Those actions always
> require an interactive 2FA challenge.

npm does not publish a list of which commands are "account-identity"
actions, and `npm whoami` is not named either way. But it queries the
account identity endpoint, and `@semantic-release/npm` calls it on every
run before publishing.

If `whoami` is covered by that restriction, then on an account with 2FA
enabled **a freshly minted token will fail exactly like the expired one**,
and any amount of rotation is wasted effort.

The test that settles it is the `npm whoami` check in §4. A 401 from a
brand-new, correctly-scoped token is the signal: stop rotating and go to
§6. Record the result here when someone establishes it, so the next
person inherits an answer rather than this paragraph.

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
