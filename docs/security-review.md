# Security review (CD-24)

A review of ClinicDesk against the [OWASP Top 10 (2021)](https://owasp.org/Top10/), done
in November 2026 together with the hardening in CD-24. The table has one row per category.
The status is one of:

- **ok**: already handled before this ticket
- **fixed in this PR**: handled by CD-24
- **finding**: a gap that remains. Each finding has a ticket at the end of this document.

## OWASP Top 10 (2021)

| # | Category | Status | Evidence | Remaining finding (ticket) |
|---|---|---|---|---|
| A01 | Broken Access Control | ok | `requireRole` and `canAccessOwnedResource` (`server/src/auth/authorize.js`). Customers get 404 for other customers' tickets. Admin-only user and audit routes. Every protected route is tested against every role in `server/tests/routeAccess.test.js`. | None |
| A02 | Cryptographic Failures | ok, and fixed in this PR | bcrypt with 12 rounds (`server/src/auth/password.js`). JWT verification pinned to `HS256` (`authenticate.js`). **New:** in production, `JWT_SECRET` must be at least 32 characters (`config.js`, `config.test.js`). **New:** HSTS on every API response (helmet, `security.test.js`). | Session token in `sessionStorage` (T4) |
| A03 | Injection | ok, and fixed in this PR | Every body and query is validated with zod. Unknown or operator-style query keys (`role[$ne]`) are a 400. Searches are escaped literals (`queryParams.js`). React escapes output, and there is no `dangerouslySetInnerHTML` or `eval`. **New:** a strict CSP on the API (`default-src 'none'`) and on the client (`'self'` only, no `unsafe-inline`; `client/vercel.json`, `vercelHeaders.test.js`). | None |
| A04 | Insecure Design | fixed in this PR | **New:** rate limits on login (failed attempts), register, and the whole API (`server/src/security/rateLimit.js`, `security.test.js`). **New (fix):** behind Cloudflare the limiters key on `CF-Connecting-IP` (`TRUST_CF_CONNECTING_IP=true`), not on a client-controlled `X-Forwarded-For` entry; IPv6 is counted per /56 (see "Rate-limit client key"). Last-admin and self-change safeguards (`docs/user-management.md`). Same answer for an unknown email, a wrong password and a deactivated account. | Per-account login throttling (T3); shared limiter store before scaling (T2) |
| A05 | Security Misconfiguration | fixed in this PR | **New:** helmet on every response, including 404s and errors. **New:** CORS exact-match allowlist, with `*` refused at startup. **New:** JSON 404 instead of Express's HTML page; no `X-Powered-By`. **New:** startup checks for `CLIENT_ORIGIN`, `TRUST_PROXY` and `RATE_LIMIT_*`. **New:** client headers (`nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`). 500s never include error details. | None |
| A06 | Vulnerable and Outdated Components | finding | `npm audit`: client 0; server production dependencies 0. Server dev dependencies: 19 moderate, 0 high, 0 critical (see below). Lockfiles are used with `npm ci` in CI. | Dev toolchain advisories and dependency automation (T5) |
| A07 | Identification and Authentication Failures | ok, and fixed in this PR | Password 8 characters to 72 bytes. bcrypt compares against a dummy hash for unknown emails, so both failures take a similar time. The role and active state are read from the database on every request, so deactivation applies at once. **New:** failed logins are rate limited. **New (fix):** the login limit really triggers on Render: before, a different `X-Forwarded-For` on each attempt gave a fresh counter (see "Rate-limit client key"). | No password change or reset; admin-set temporary passwords never expire (T1). No MFA for admins (T7). |
| A08 | Software and Data Integrity Failures | ok | `package-lock.json` plus `npm ci`. JWTs are signed and the algorithm is pinned. CI runs with `permissions: contents: read`. The audit log is append-only (`docs/audit-log.md`). | GitHub Actions pinned to tags, not commit SHAs (T6) |
| A09 | Security Logging and Monitoring Failures | ok, with findings | The audit log records logins (including failures), status, assignment and user changes (CD-20). **New:** a rate-limited request (429) writes no audit entry (`security.test.js`), so the limiter also caps how fast an attacker can fill the log. | No retention for the audit log (T8). No alerting on failed-login bursts (part of T3). |
| A10 | Server-Side Request Forgery | ok | The server makes no outbound HTTP requests. There is no URL input and no webhooks; its only connection is to MongoDB, from `MONGODB_URI`. | None |

## What CD-24 changed

**API (`server/src/app.js`)**

- **helmet** is the first middleware: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy:
  no-referrer`, COOP and CORP, and no `X-Powered-By`. The CSP is `default-src 'none';
  frame-ancestors 'none'`, because the API only returns JSON.
- **CORS allowlist:**
  - `CLIENT_ORIGIN` takes several comma-separated origins.
  - The request's origin is echoed only on an exact match, and `*` is never sent.
    `Vary: Origin` is on every response.
  - Preflights from other origins are not answered: no 204 and no allow headers.
  - Startup refuses `*`, or any entry that is not a bare origin.
- **Rate limits** (`server/src/security/rateLimit.js`):
  - `429 { error: { code: "RATE_LIMITED", message } }` with `Retry-After` and the
    draft-7 `RateLimit` and `RateLimit-Policy` headers.
  - Login: 10 *failed* attempts per 15 minutes per IP (successful logins are not counted).
    Register: 5 per hour per IP. Everything under `/api/v1`: 300 per 15 minutes per IP.
    `/health` is never limited.
  - All of these can be set with `RATE_LIMIT_*`.
  - The counters are **in memory**, which is correct for one Render instance. Several
    instances would each count on their own (T2).
- **`trust proxy`** comes from `TRUST_PROXY`: by default `1` in production and `false`
  elsewhere, so the limiter sees the client's IP behind Render's proxy. `true` is refused
  at startup, because then any client could choose its own IP.
- **Startup checks** (`server/src/config.js`): in production `JWT_SECRET` must be at least
  32 characters, and `CLIENT_ORIGIN`, `TRUST_PROXY`, `TRUST_CF_CONNECTING_IP`,
  `DEBUG_CLIENT_IP` and `RATE_LIMIT_*` are validated.
- Unknown paths answer a **JSON 404** in the uniform error shape.
- `server/.env.example` documents the new variables and no longer has the client's
  `VITE_API_URL`.

**Client (`client/vercel.json`)**

- Every route gets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that turns
  off camera, microphone, geolocation, payment and USB.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src
  'self'; connect-src 'self' https://clinicdesk-api-2uh0.onrender.com; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
  - Fonts are self-hosted with `@fontsource`. No Google Fonts hosts are needed.
  - The build has no inline scripts, inline styles or `data:` URLs.
  - **`connect-src` must list the production API origin** (`VITE_API_URL` on Vercel), today
    `https://clinicdesk-api-2uh0.onrender.com`. **When the Render service URL changes,
    `connect-src` in `client/vercel.json` must be changed too, otherwise the browser blocks
    all API calls.** This already happened once: the first version of this policy listed a
    guessed URL without the suffix Render adds to the service name, and every call failed
    with "Could not reach the ClinicDesk API" until the hotfix (`fix/CD-24-csp-api-url`).
    `client/src/security/vercelHeaders.test.js` guards this, because JSON cannot hold a
    comment.
- How the policy was checked: the production build was served locally with exactly these
  headers, plus a `report-uri`, and opened in headless Firefox.
  - `/login` and `/health-check` rendered fully, with scripts, styles and fonts, and the
    same-origin API call worked. There were 0 CSP violation reports.
  - A build pointing at another API origin was blocked under this policy (1 `connect-src`
    report, and the page shows "Could not reach the ClinicDesk API"). It worked once that
    origin was added to `connect-src`.

## Rate-limit client key

Added by `fix/CD-24-rate-limit-client-ip`, after the first deployment.

- **Why the key matters.** Each limiter counts per key. A key the client can change gives the
  client a fresh counter per attempt, so brute force is never slowed. A key all clients share
  lets one attacker lock everyone out.
- **What went wrong.** On Render the API sits behind Cloudflare and Render's load balancer.
  `req.ip` comes from `X-Forwarded-For` and the `TRUST_PROXY` hop count, but a client's own
  `X-Forwarded-For` value stays in that header, and no fixed hop count picked an entry the
  client could not choose. A test with 14 wrong logins and a different `X-Forwarded-For` on each got 401 every
  time, with `TRUST_PROXY=1` and with `TRUST_PROXY=2`.
- **The fix.** `TRUST_CF_CONNECTING_IP=true` (set in `render.yaml`) makes the login, register
  and global limiters key on `CF-Connecting-IP`. Cloudflare sets it to the address that
  connected to it and overwrites a client-sent value. It is used only when it is a bare IPv4
  or IPv6 address (`node:net` `isIP`); otherwise the key is `req.ip`. Every key goes through
  express-rate-limit's `ipKeyGenerator`, so IPv6 addresses count per /56 network.
  `X-Forwarded-For` no longer changes the key while the flag is on. `TRUST_PROXY` stays as it
  was (`1`), so `req.ip` keeps its old meaning as the fallback. Tests:
  `server/tests/security.test.js` ("rate-limit client key", "clientKeyGenerator") and
  `server/tests/config.test.js`.
- **Risk.** The header is spoofable on any host that can be reached without Cloudflare. The
  flag is `false` by default, must never be turned on for such a host, and any value other
  than `true` or `false` stops the server at startup.
- **Temporary debug log.** `DEBUG_CLIENT_IP=true` logs one JSON line per failed login with
  `req.ip`, `req.ips`, `X-Forwarded-For`, `CF-Connecting-IP` and the socket address (no email,
  password, token or body). It is off by default and is to be removed once the Render setup is
  confirmed.

## Secret scan

| Scan | Scope | Result |
|---|---|---|
| gitleaks (Docker `ghcr.io/gitleaks/gitleaks`), `git` mode with `--log-opts="--all --full-history"` | All branches and history | No leaks found |
| gitleaks, `dir` mode | Working tree: every tracked and untracked, non-ignored file (164 files; no `node_modules`) | No leaks found |
| Pattern search over `git log --all -p` (all 109 commits) | MongoDB URIs with credentials, Atlas hosts, AWS, GitHub, Slack, Stripe and Google keys, JWTs, private keys | 0 matches |
| `.env` files ever committed | All history | Only `.env.example`, `server/.env.example` and `client/.env.example`. They only ever held empty values, `localhost` values, `PORT=3000` and `JWT_EXPIRES_IN=1h`. |

Nothing was found, so nothing had to be rotated. Test files use obvious placeholders
(`'a-long-password'`, `'test-secret'`, `'x'.repeat(32)`).

## npm audit

| Package | Production dependencies | All dependencies |
|---|---|---|
| server | 0 vulnerabilities | 19 moderate, 0 high, 0 critical |
| client | 0 vulnerabilities | 0 vulnerabilities |

All 19 server advisories are in the dev toolchain (test runner and file watcher). The API
never runs them in production (`npm start` is `node src/server.js`), and none of them
handles requests:

- 18 come through `jest` 30 → `glob` / `minimatch` ([GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)).
- 1 comes through `nodemon` → `minimatch`.

npm's suggested "fix" is a major *downgrade* (jest 29, nodemon 3.1.11), so it was not
applied. See T5.

## Findings: new tickets

Each finding below is ready to be created as a Trello ticket.

### T1: Password change, reset and expiring temporary passwords
- **Priority:** High
- **Description:** Users cannot change their password, and nobody can reset a forgotten
  one. A temporary password set by an admin (`POST /users`) never expires and is never
  forced to change, so it stays known to the admin. (OWASP A07)
- **Acceptance criteria:**
  - A logged-in user can change their password by giving the current one. Same rules as
    register.
  - Accounts created by an admin must set a new password at first login. Until then, every
    other route answers 403 with a clear code.
  - An admin can issue a new temporary password, and that action is in the audit log.
  - Changing the password ends existing sessions (tokens issued before the change get 401).

### T2: Shared rate-limit store before running more than one API instance
- **Priority:** Low (only needed when scaling)
- **Description:** The rate-limit counters are in memory, per process. With two or more
  Render instances, each counts on its own, so the real limit grows with the number of
  instances. (OWASP A04)
- **Acceptance criteria:**
  - The limiters use a shared store (for example Redis) when one is configured, and memory
    otherwise.
  - A test shows that two app instances share one counter.
  - The docs name the variable and the default.

### T3: Per-account login throttling and alerts on failed-login bursts
- **Priority:** Medium
- **Description:** The login limit is per IP. An attacker using many IPs can keep guessing
  one account's password. Bursts of failed logins are recorded in the audit log, but nobody
  is told. (OWASP A04, A07, A09)
- **Acceptance criteria:**
  - After N failed logins for one email within a window, that email gets an increasing delay
    or a temporary block, whatever the IP. The answer is the same whether or not the account
    exists.
  - Admins can see accounts under attack: a filter or count of `auth.login_failed` per email
    in the audit log page.
  - Tests cover the per-account limit and show that a successful login is not blocked once
    the window has passed.

### T4: Move the session token out of sessionStorage
- **Priority:** Medium
- **Description:** The JWT is kept in `sessionStorage` (see `client/src/auth/session.js`),
  where any script on the page can read it. The new CSP makes XSS much harder, but an
  `httpOnly` cookie would keep the token out of JavaScript entirely. (OWASP A02, A07)
- **Acceptance criteria:**
  - The API sets the session in an `httpOnly`, `Secure`, `SameSite` cookie, and the client no
    longer stores the token.
  - State-changing requests are protected against CSRF (SameSite plus an origin check or a
    CSRF token).
  - CORS allows credentials only for the allowlisted origins, never `*`.
  - Logout clears the cookie. Existing role and active checks still apply on every request.

### T5: Dependency updates and automated dependency checks
- **Priority:** Low
- **Description:** `npm audit` shows 19 moderate advisories in the server's dev toolchain
  (jest 30, nodemon → glob and minimatch). They don't ship, but nothing alerts us to new
  advisories. (OWASP A06)
- **Acceptance criteria:**
  - Dependabot (or Renovate) is enabled for `server/`, `client/` and GitHub Actions.
  - CI runs `npm audit --omit=dev --audit-level=high` for server and client, and fails on high
    or critical advisories in production dependencies. The existing job names stay as they
    are.
  - The dev advisories are cleared once jest and nodemon publish fixed versions, without
    downgrading.

### T6: Pin GitHub Actions to commit SHAs
- **Priority:** Low
- **Description:** `ci.yml` uses `actions/checkout@v7`, `actions/setup-node@v7` and
  `actions/upload-artifact@v7`. A moved or compromised tag would run new code in CI.
  (OWASP A08)
- **Acceptance criteria:**
  - Every `uses:` is pinned to a full commit SHA, with the version in a comment.
  - Dependabot updates them (T5).
  - The job names are unchanged.

### T7: Multi-factor authentication for admins
- **Priority:** Low
- **Description:** Admin accounts can create users, change roles and read the audit log, but
  are protected by a password only. (OWASP A07)
- **Acceptance criteria:**
  - Admins can enrol a TOTP authenticator, and login asks for the code once enrolled.
  - Enrolment and removal are in the audit log.
  - A documented recovery path exists that uses no default credentials.

### T8: Audit log retention
- **Priority:** Medium
- **Description:** Every failed login writes an audit entry, and nothing is ever removed, so
  the collection grows without limit. An attacker can grow it on purpose. The rate limit
  slows this to at most 10 failed logins per IP per 15 minutes, but does not stop it across
  many IPs or over months. (OWASP A09)
- **Acceptance criteria:**
  - Retention is decided and documented (for example 365 days for user and ticket events,
    90 days for `auth.login_failed`).
  - It is enforced by a TTL index on `createdAt` (per action group if the periods differ) or
    by a scheduled cleanup job that runs with database rights, never through the app's
    append-only model.
  - The append-only rule for the app stays as it is: no update or delete route, and the model
    still refuses changes.
  - `docs/audit-log.md` describes the retention.
