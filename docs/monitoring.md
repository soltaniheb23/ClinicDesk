# Error monitoring (CD-25)

ClinicDesk reports unexpected errors to [Sentry](https://sentry.io): the API with
`@sentry/node` and the client with `@sentry/react`. Monitoring is **off unless a DSN is
configured**: `SENTRY_DSN` on Render for the API and `VITE_SENTRY_DSN` on Vercel for the
client. Without a DSN the SDK is never initialised, so no event is built and no network call
is made. The test suites never initialise the real SDK. Tests that need Sentry pass a mock.

## What is reported

| Where | Reported | Never reported |
|---|---|---|
| API | The `500 INTERNAL_ERROR` branch of the error handler (`server/src/app.js`); uncaught exceptions; unhandled promise rejections | Every 4xx: invalid JSON (400), too large bodies (413), validation errors, 401, 403, 404, 429 |
| Client | Render errors caught by the error boundary (`client/src/monitoring/AppErrorBoundary.jsx`); uncaught errors and unhandled rejections in the page | Failed API calls that the page already shows to the user (4xx answers) |

- The API's answers do not change. A 500 is still
  `{ "error": { "code": "INTERNAL_ERROR", "message": "Something went wrong" } }`, and the
  error is still logged to the Render log with `console.error`. Sentry gets a copy.
- An uncaught exception is reported and the process then exits, as before (Render restarts
  it). Unhandled rejections use the SDK's `strict` mode: they are reported and the process
  exits, the same as Node does without Sentry. The SDK's default (`warn`) would have kept the
  process running.
- Each server event carries the caller's **opaque user id** (`request.user.id`) when a user
  was logged in, plus the `http.method` tag. Nothing else is sent about the user.
- On the client, a render error replaces the page with "Something went wrong" and a
  **Reload** button. The fallback never shows the error message.

## What is removed (privacy)

ClinicDesk handles a clinic's support tickets, so ticket text and personal data must never
reach a third party. Three layers keep them out:

1. **`sendDefaultPii: false`.** SDK v11 replaced this option with `dataCollection`, so both
   are set. Every `dataCollection` category is off: user info, cookies, HTTP headers, HTTP
   bodies, URL query parameters, stack-frame local variables, database query data (server)
   and queue arguments (server). The server's `serverName` is fixed to `clinicdesk-api`,
   because the default is the machine's hostname.
2. **One scrub function per side**, used as `beforeSend` and `beforeBreadcrumb`:
   `server/src/monitoring/scrub.js` and `client/src/monitoring/scrub.js`. The two files hold
   the same rules and must stay in step. They remove:
   - the request body (`request.data`), cookies (`request.cookies`) and the query string
     (`request.query_string`);
   - the query string and fragment of every URL (`url`, `from`, `to`, `Referer`), in events
     and in breadcrumbs (fetch, XHR, navigation);
   - any field, at any depth, whose name contains `password`, `pass`, `token`, `secret`,
     `authorization`, `cookie`, `apikey` or `email`, and the ticket text fields `title`,
     `description`, `body`, `text` and `comment`. This includes the `Authorization` and
     `Cookie` headers;
   - every user field except `id` (no email, name, username or IP address);
   - in free text (error messages, console lines), email addresses become `[email]`, and
     `Bearer …` values and JWTs become `[Filtered]`. This catches, for example, a MongoDB
     duplicate-key message that quotes an email address;
   - on the client, `ui.input` breadcrumbs (what was typed into a form) are dropped.
3. **No tracing and no session replay.** `tracesSampleRate` is not set and no replay
   integration is added, so no transactions, spans or screen recordings are sent.

The rules are tested in `server/tests/monitoring.test.js` and
`client/src/monitoring/monitoring.test.jsx`.

## Sample rates

| Setting | Value | Where |
|---|---|---|
| `sampleRate` (errors) | `1.0`, every error | `ERROR_SAMPLE_RATE` in both `sentry.js` files |
| `tracesSampleRate` (performance) | not set, tracing off | |
| Session replay | not used | |

ClinicDesk's traffic is small, so every error is kept. If the Sentry quota becomes a
problem, lower `ERROR_SAMPLE_RATE` or add a rate limit in the Sentry project settings
(**Settings > Projects > [project] > Client Keys > Rate Limits**).

## Setting it up

Create two projects in Sentry: a **Node.js** project for the API and a **React** project for
the client. For a clinic, choose the **EU (Frankfurt)** data region when creating the
organisation; its DSNs end in `ingest.de.sentry.io`. Copy each DSN from **Project Settings >
Client Keys (DSN)**. A DSN looks like `https://<public-key>@o<org-id>.ingest.<region>.sentry.io/<project-id>`.

### Render (API)

1. In the Render dashboard, open the `clinicdesk-api` service and go to **Environment**.
2. Set `SENTRY_DSN` to the Node.js project's DSN. `render.yaml` declares the key with
   `sync: false`, so the value is only ever in the dashboard, never in the repository.
3. Optional: set `SENTRY_ENVIRONMENT` (for example `staging`). Without it the environment is
   `NODE_ENV` (`production` on Render). The release is Render's `RENDER_GIT_COMMIT`, set
   automatically.
4. Save. Render redeploys. A value that is not an `https://` URL stops the API at startup with:
   `Startup error: SENTRY_DSN must be an https URL, the DSN from Sentry (…)`. The value
   itself is never printed. To turn monitoring off, delete the variable or leave it empty.

### Vercel (client)

1. In the Vercel project (Root Directory `client`), open **Settings > Environment Variables**.
2. Add `VITE_SENTRY_DSN` with the React project's DSN for **Production** and **Preview**.
3. Redeploy. `VITE_*` values are read at build time, so a change needs a new build.
4. The environment tag is Vercel's `VERCEL_ENV` (`production` or `preview`) and the release
   is `VERCEL_GIT_COMMIT_SHA`. Both are system variables that Vercel provides during the
   build (`client/vite.config.js`). `VITE_SENTRY_ENVIRONMENT` and `VITE_SENTRY_RELEASE`
   override them. Without a commit SHA the release is left out.
5. In the React project, set **Settings > Security & Privacy > Allowed Domains** to the Vercel
   domain. The browser DSN is public by design: it is part of the JavaScript bundle. This
   setting stops other sites from sending events with it.

A `VITE_SENTRY_DSN` that is not an `https://` URL leaves monitoring off and logs a warning in
the browser console.

### Content Security Policy

The browser sends events straight to Sentry's ingest host, for example
`o123.ingest.de.sentry.io`. The client's CSP (`client/vercel.json`) only lets the page
connect to the hosts listed in `connect-src`, so these hosts were added:

```
connect-src 'self' https://clinicdesk-api-2uh0.onrender.com https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io
```

**Why this matters:** in CD-24 the first version of the CSP listed a guessed API URL, and the
browser blocked every API call ("Could not reach the ClinicDesk API") until the hotfix
(`fix/CD-24-csp-api-url`, see [security review](security-review.md)). A missing Sentry host
fails the same way, but silently: the app keeps working and the events are dropped by the
browser, with only a CSP violation in the console. Nothing else in the policy changed: the API
origin is the same, and `script-src`, `style-src`, `img-src` and the other directives stay at
`'self'` or `'none'`. These three Sentry hosts are the only wildcards in the policy, and
`client/src/security/vercelHeaders.test.js` checks that no other one is added.

## Proving it works: test errors

### Server

`POST /api/v1/debug/sentry-test` is **admin only** (401 without a token, 403 for agents and
customers) and counts toward the global `/api/v1` rate limit. It throws a test error, catches
it, reports it and answers `{ "ok": true }`. Log in as an admin, then:

```sh
TOKEN=$(curl -s https://clinicdesk-api-2uh0.onrender.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin email>","password":"<password>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s -X POST https://clinicdesk-api-2uh0.onrender.com/api/v1/debug/sentry-test \
  -H "Authorization: Bearer $TOKEN"
# {"ok":true}
```

Or, logged in as an admin in the deployed client, run this in the browser console:

```js
fetch('https://clinicdesk-api-2uh0.onrender.com/api/v1/debug/sentry-test', { method: 'POST', headers: { Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('clinicdesk.auth')).token}` } }).then((r) => r.json()).then(console.log)
```

In the Node.js project's **Issues** list, an issue named
`Error: ClinicDesk Sentry test error (server, POST /api/v1/debug/sentry-test)` appears within
a minute, with the tag `sentry_test: true`, the admin's user id and no other user data. The
answer is `{ "ok": true }` even while monitoring is off, so if no issue appears, check
`SENTRY_DSN` on Render.

### Client

The client has no test button. On the deployed client, open the browser console and run:

```js
setTimeout(() => { throw new Error('ClinicDesk Sentry test error (client)'); });
```

The console shows the uncaught error, and the React project's **Issues** list shows
`Error: ClinicDesk Sentry test error (client)` within a minute, tagged with the environment
and the release (the commit SHA). If nothing arrives, check `VITE_SENTRY_DSN` on Vercel (and
that the deployment was rebuilt after it was set), and look for a CSP violation in the
console.

## Known limits

- **No source maps yet.** Client stack traces point into the minified bundle
  (`assets/index-<hash>.js`). Uploading source maps needs a Sentry auth token in the Vercel
  build and is left for a later ticket. Server stack traces are readable, because the API is
  not bundled.
- **No alerting rules** are set up in the repository. Configure alert e-mails in the Sentry
  project (**Alerts**).
- **Bundle size.** The browser SDK adds about 97 kB minified (about 33 kB gzipped) to the
  client bundle, even when the DSN is not set.
- **The browser DSN is public.** Anyone can read it from the bundle and send fake events.
  Allowed Domains and the project's rate limits contain this; it cannot leak data.
- **The scrubber works on field names and patterns.** A new field holding personal data
  under an unusual name (not `title`, `description`, `body`, `email` …) would not be
  removed. Add its name to both scrub files when adding such a field.
- **4xx answers that hide a bug** (for example a validation rule that is wrong) are not
  reported, by design.

## Files

| File | Purpose |
|---|---|
| `server/src/monitoring/sentry.js` | `initSentry`, `captureError`, the init options |
| `server/src/monitoring/scrub.js` | `scrubEvent`, `scrubBreadcrumb` |
| `server/src/server.js` | Calls `initSentry` before the app is required |
| `server/src/app.js` | Calls `captureError` in the 500 branch of the error handler |
| `server/src/routes/debug.js` | `POST /api/v1/debug/sentry-test` |
| `server/src/config.js` | `SENTRY_DSN` startup validation (`parseSentryDsn`) |
| `client/src/monitoring/sentry.js` | `initMonitoring`, the init options |
| `client/src/monitoring/scrub.js` | `scrubEvent`, `scrubBreadcrumb` |
| `client/src/monitoring/AppErrorBoundary.jsx` | Error boundary and fallback |
| `client/src/main.jsx` | Calls `initMonitoring` and wraps the app in the boundary |
| `client/vite.config.js` | Release and environment tags from Vercel |
| `client/vercel.json` | `connect-src` with the Sentry ingest hosts |
