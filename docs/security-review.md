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
| A04 | Insecure Design | fixed in this PR | **New:** rate limits on login (failed attempts), register, and the whole API (`server/src/security/rateLimit.js`, `security.test.js`). **CD-18:** file uploads are limited by size, count and their own rate limit, and checked by content (see "File uploads"). **New (fix):** behind Cloudflare the limiters key on `CF-Connecting-IP` (`TRUST_CF_CONNECTING_IP=true`), not on a client-controlled `X-Forwarded-For` entry; IPv6 is counted per /56 (see "Rate-limit client key"). Last-admin and self-change safeguards (`docs/user-management.md`). Same answer for an unknown email, a wrong password and a deactivated account. | Per-account login throttling (T3); shared limiter store before scaling (T2) |
| A05 | Security Misconfiguration | fixed in this PR | **New:** helmet on every response, including 404s and errors. **New:** CORS exact-match allowlist, with `*` refused at startup. **New:** JSON 404 instead of Express's HTML page; no `X-Powered-By`. **New:** startup checks for `CLIENT_ORIGIN`, `TRUST_PROXY` and `RATE_LIMIT_*`. **New:** client headers (`nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`). 500s never include error details. | None |
| A06 | Vulnerable and Outdated Components | finding | `npm audit`: client 0; server production dependencies 0. Server dev dependencies: 19 moderate, 0 high, 0 critical (see below). Lockfiles are used with `npm ci` in CI. | Dev toolchain advisories and dependency automation (T5) |
| A07 | Identification and Authentication Failures | ok, and fixed in this PR | Password 8 characters to 72 bytes. bcrypt compares against a dummy hash for unknown emails, so both failures take a similar time. The role and active state are read from the database on every request, so deactivation applies at once. **New:** failed logins are rate limited. **New (fix):** the login limit really triggers on Render: before, a different `X-Forwarded-For` on each attempt gave a fresh counter (see "Rate-limit client key"). | No password change or reset; admin-set temporary passwords never expire (T1). No MFA for admins (T7). |
| A08 | Software and Data Integrity Failures | ok | `package-lock.json` plus `npm ci`. JWTs are signed and the algorithm is pinned. CI runs with `permissions: contents: read`. The audit log is append-only (`docs/audit-log.md`). | GitHub Actions pinned to tags, not commit SHAs (T6) |
| A09 | Security Logging and Monitoring Failures | ok, with findings | The audit log records logins (including failures), status, assignment and user changes (CD-20). **New:** a rate-limited request (429) writes no audit entry (`security.test.js`), so the limiter also caps how fast an attacker can fill the log. **CD-25:** unexpected errors (5xx, uncaught exceptions, client render errors) are reported to Sentry when a DSN is set, scrubbed of personal data (see "Third-party processor: Sentry"). | No retention for the audit log (T8). No alerting on failed-login bursts (part of T3). |
| A10 | Server-Side Request Forgery | ok | There is no URL input and no webhooks. The server connects to MongoDB (`MONGODB_URI`), to the SMTP server when email is on (CD-21), and to Sentry's ingest host when `SENTRY_DSN` is set (CD-25). All three come from configuration, never from a request. | None |

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
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. (CD-25 later added the Sentry
  ingest hosts to `connect-src` only; see "Third-party processor: Sentry".)
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

## File uploads (CD-18)

Attachments ([attachments](attachments.md), decision:
[GridFS storage](decisions/CD-18-attachment-storage.md)) add the classic upload risks. Each
one and what handles it:

| Risk | Mitigation | Test |
|---|---|---|
| Executable or script uploaded and run (web shell, HTML/SVG with script) | Only PNG, JPEG and PDF, decided by **magic bytes**, never by the client's Content-Type or extension. HTML, SVG, executables and empty files are refused. Files are never written to disk or a static path, so nothing can be executed or served by a web server. | `attachmentHelpers.test.js`, `attachments.test.js` ("rejects …", "no file is ever written to disk") |
| File served inline and rendered by the browser (stored XSS, content sniffing) | Downloads only: `Content-Disposition: attachment`, `Content-Type` = the detected type, `X-Content-Type-Options: nosniff`, and helmet's `default-src 'none'` CSP. No image previews in the client. | `attachments.test.js` (download headers) |
| Path traversal or overwrite through the filename | The name is only metadata: basename only, control and bidi characters removed, no leading dots, at most 100 characters, extension forced to match the detected type. GridFS files are named with a random UUID. | `attachmentHelpers.test.js` (sanitiser), `attachments.test.js` (GridFS names) |
| Reading other customers' files (IDOR) | Every route uses the ticket's access rule: another customer's ticket is the same `404` as an unknown one, and an attachment id is only looked up within its ticket. No public URL exists. | `attachments.test.js`, `routeAccess.test.js` |
| Deleting other people's files | Uploader or admin only; agents only their own. | `attachments.test.js` (delete) |
| Denial of service: huge bodies, many files, quota exhaustion | multer memory storage with `fileSize` 2 MB (reading stops past it), 3 files per request, 5 per ticket, a dedicated upload rate limit (20 per 15 minutes per client) on top of the global one. Atlas M0's 512 MB quota is the remaining risk (see the decision record). | `attachments.test.js` (413, counts, 429), `security.test.js` |
| Cached copies of private files | `Cache-Control: private, no-store`. | `attachments.test.js` |
| Vulnerable upload parser | multer 2.5.0 (busboy 1.6), the current release. `npm audit --omit=dev`: 0 vulnerabilities. | |

**Residual risks** (in [attachments](attachments.md#known-limits)): no virus scanning; a
PDF can still carry harmful content for the user's PDF reader; JPEG EXIF metadata (GPS) is
kept; a narrow race can exceed 5 files per ticket; the M0 storage quota.

## Third-party processor: Sentry (CD-25)

Sentry receives error reports from the API and the client when `SENTRY_DSN` (Render) or
`VITE_SENTRY_DSN` (Vercel) is set. It is a third-party processor and has to be listed as one
in the clinic's records of processing. Choose the EU data region
(`*.ingest.de.sentry.io`). Details: [monitoring](monitoring.md).

- **Off by default.** Without a DSN the SDK is never initialised and makes no network call.
  The test suites never initialise it (a mock is injected where needed).
- **What Sentry receives:** the error type, message and stack trace (with emails, bearer
  tokens and JWTs in the message replaced), the URL path without its query string, the HTTP
  method, the browser's user agent (client events), the environment and release tags, the SDK's runtime context, and the
  **opaque user id** of a logged-in caller.
- **What Sentry never receives:** request or response bodies, cookies, query strings, the
  `Authorization` header, passwords, tokens, secrets, email addresses, any user field other
  than the id (name, username, IP address), ticket titles, descriptions, comment bodies and internal notes, form input, local
  variables, and database query data. `sendDefaultPii` is `false`, and every SDK v11
  `dataCollection` category is off. On top of that, one tested scrub function per side
  (`server/src/monitoring/scrub.js`, `client/src/monitoring/scrub.js`) runs as `beforeSend` and
  `beforeBreadcrumb` and removes these fields again. No tracing and no session replay.
- **Only unexpected errors.** The API reports only the 500 branch of its error handler, plus
  uncaught exceptions and unhandled rejections. 4xx answers are never reported, so failed
  logins, 403s and 404s for other customers' tickets do not reach Sentry. The answers
  themselves did not change.
- **Startup check:** `SENTRY_DSN` must be an `https://` URL, or the API refuses to start. The
  value is never printed.
- **Test route:** `POST /api/v1/debug/sentry-test` is admin only, rate limited by the global
  limiter, and listed in [roles and permissions](roles-and-permissions.md) and in
  `routeAccess.test.js`.
- **Client CSP:** `connect-src` additionally allows `https://*.ingest.sentry.io`,
  `https://*.ingest.de.sentry.io` and `https://*.ingest.us.sentry.io`. Without them the browser
  would silently block every event, the same class of failure as the CD-24 API URL incident.
  No other directive changed, and these are the only wildcards in the policy
  (`vercelHeaders.test.js`).
- **Residual risk:** the browser DSN is public (it is in the bundle), so anyone can send fake
  events. Allowed Domains and rate limits in the Sentry project contain this, and it cannot
  read data. The scrubber matches field names and text patterns: a new personal field under
  an unusual name must be added to both scrub files.

## Rate-limit client key

Added by `feature/CD-24-rate-limit-client-ip`, after the first deployment.

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
