# ClinicDesk

[![CI](https://github.com/soltaniheb23/ClinicDesk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/soltaniheb23/ClinicDesk/actions/workflows/ci.yml)

A helpdesk and ticketing app for a small clinic, built as a simulation of a real
software project: sprints, tickets, pull requests, CI/CD, and a client change request.

## Problem
Clinic staff send support requests by phone and email, and requests get lost.
ClinicDesk gives them one place to create, track, and resolve tickets.

## Planned features
- Role-based access: Customer, Agent, Admin
- Ticket workflow: Open > In Progress > Waiting > Resolved > Closed
- Comments, internal notes, and file attachments
- Agent dashboard with filters and search
- Email notifications and SLA timers
- Audit log of important actions

## Tech stack
**In use:** React, React Router, Vite, Node.js, Express, Jest, Supertest, Vitest, ESLint, Prettier, GitHub Actions

**Planned:** MongoDB Atlas data integration, Tailwind CSS, Playwright, Sentry

## Getting started

Use the current Node.js LTS release and npm.

Install dependencies in separate terminals:

```sh
cd server
npm ci
cp .env.example .env
npm run dev
```

```sh
cd client
npm ci
npm run dev
```

The client runs at <http://localhost:5173>; the API health check is at
<http://localhost:3000/health>.
The client page at <http://localhost:5173/health-check> requests `/api/v1/hello`
through the Vite development proxy. Start the server before opening it to see its
API greeting. The other routes are `/login`, `/register` and `/tickets` (requires
login); `/` redirects to `/tickets`. Registering or logging in needs the server's
`MONGODB_URI` and `JWT_SECRET` (see `server/.env.example`).

Run checks from each app folder:

```sh
npm run lint
npm test
```

The client also has a production build:

```sh
npm run build
```

GitHub Actions runs the server lint and tests (with coverage) and the client lint,
tests, and build on pull requests targeting `main` and pushes to `main`.

## Testing and coverage

Server tests use Jest, Supertest and an in-memory MongoDB (mongodb-memory-server), so no
database or `.env` is needed:

```sh
cd server
npm test               # all tests
npm run test:coverage  # same tests plus a coverage report in server/coverage/
```

`npm run test:coverage` prints a summary and a per-file table, and writes an HTML report
to `server/coverage/lcov-report/index.html`. It fails if statements, branches, functions
or lines drop below **80%** (`coverageThreshold` in `server/package.json`). `src/server.js`
is left out because it only starts the listener.

In CI, the server job runs `npm run test:coverage`. The summary table is shown on the
workflow run's **Summary** page, and the full report is attached as the
**server-coverage** artifact (kept for 14 days).

The client tests use Vitest and Testing Library: `cd client && npm test`.

## Staging

The client and server are deployed separately. Set these environment variables in each service (never commit real values):

| Where | Variable | Value |
|---|---|---|
| Vercel (client) | `VITE_API_URL`  | The Render API URL, no trailing slash 	   |
| Render (server) | `CLIENT_ORIGIN` | The Vercel URL, no trailing slash 		   |
| Render (server) | `MONGODB_URI` 	| The MongoDB Atlas connection string (secret) |

## Security

The API sends security headers on every response (helmet, with a JSON-only CSP), allows only
the listed frontend origins (CORS), and rate limits logins, registrations and the whole API.
The client sends its own headers and CSP from `client/vercel.json`. The OWASP Top 10 review,
the secret scan and the open findings are in
[`docs/security-review.md`](docs/security-review.md).

| Variable (server) | Default | Meaning |
|---|---|---|
| `CLIENT_ORIGIN` | none | Allowed frontend origins, comma-separated, exact matches only (`https://clinicdesk.vercel.app,https://staging.example.com`). `*` stops the server at startup. |
| `TRUST_PROXY` | `1` in production, otherwise `false` | Proxy hops in front of the API, so the rate limits see the client's IP. Render needs `1`. `true` is refused. |
| `TRUST_CF_CONNECTING_IP` | `false` | `true`: the rate limits key on Cloudflare's `CF-Connecting-IP` header (when it is a valid IP address), not on `X-Forwarded-For`. Set `true` on Render. Only for a host that every request reaches through Cloudflare. Anything other than `true` or `false` stops the server at startup. |
| `DEBUG_CLIENT_IP` | `false` | **Temporary.** `true` logs one line per failed login with the client-IP inputs (see below). |
| `EMAIL_ENABLED` | `false` | `true` sends email on new tickets and replies ([`docs/notifications.md`](docs/notifications.md)). Then all of the variables below are required, or the server stops at startup. |
| `SMTP_HOST`, `SMTP_PORT` | none | SMTP server and port (`587` STARTTLS or `465` TLS). Use a sandbox such as Mailtrap on staging. |
| `SMTP_USER`, `SMTP_PASS` | none | SMTP credentials. Secrets: set them in the hosting dashboard only. |
| `MAIL_FROM` | none | Sender, for example `ClinicDesk <no-reply@example.com>`. |
| `APP_URL` | none | The client's http(s) URL, used for the ticket link in emails (for example `https://clinicdesk.vercel.app`). |
| `JWT_SECRET` | none | At least 32 characters in production. |
| `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS` | 10 per 15 minutes | Failed logins per IP. Successful logins are not counted. |
| `RATE_LIMIT_REGISTER_MAX`, `RATE_LIMIT_REGISTER_WINDOW_MS` | 5 per hour | Registrations per IP. |
| `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_GLOBAL_WINDOW_MS` | 300 per 15 minutes | All `/api/v1` requests per IP (`/health` is never limited). |

Limited requests get `429 RATE_LIMITED` with a `Retry-After` header. The counters are kept in
memory, which suits the single Render instance. The limits are off when `NODE_ENV=test`.

### Rate-limit client key (Render and Cloudflare)

Every limiter counts per client key, so the key must be one stable value per client that the
client cannot choose. If a client can change it, every attempt gets a fresh counter and the
login limit never triggers. If all clients share it, one attacker locks everyone out.

On Render, requests pass through Cloudflare and Render's load balancer before they reach the
API. A client's own `X-Forwarded-For` value stays in that header, and no fixed
`TRUST_PROXY` hop count picked an entry the client could not choose: with `1` and with `2`,
14 wrong logins with different `X-Forwarded-For` values all got 401. Cloudflare's `CF-Connecting-IP` header holds the address
that connected to Cloudflare, and Cloudflare overwrites any value the client sends.

**On Render, set `TRUST_CF_CONNECTING_IP=true` and leave `TRUST_PROXY` as it is** (unset,
which means `1`). `render.yaml` already does this. The limiters then use `CF-Connecting-IP`
when it is a bare IPv4 or IPv6 address and fall back to `req.ip` otherwise. IPv6 keys are
reduced to their /56 network (express-rate-limit's `ipKeyGenerator`), so one client cannot
rotate through its own IPv6 range.

> **Risk:** `CF-Connecting-IP` is just a request header. It can only be trusted when every
> request reaches the API through Cloudflare. On a host that can be reached without Cloudflare
> (local development, another hosting provider, a direct origin address), any client can send
> its own `CF-Connecting-IP` and get a fresh counter for every attempt. **Never set
> `TRUST_CF_CONNECTING_IP=true` for a host that is not behind Cloudflare.** It is `false` by
> default.

**Temporary debug log.** To see what the API receives, set `DEBUG_CLIENT_IP=true` on Render
and redeploy. Every failed login then logs one line in the Render logs:

```
[debug-client-ip] failed login {"ip":"…","ips":[…],"xForwardedFor":"…","cfConnectingIp":"…","remoteAddress":"…"}
```

It holds `req.ip`, `req.ips`, the `X-Forwarded-For` and `CF-Connecting-IP` headers and the
socket address, nothing else (no email, password, token or body). Check that
`cfConnectingIp` is your own public IP, also when you send a fake `CF-Connecting-IP` with curl.
Then delete `DEBUG_CLIENT_IP` on Render again (unset means `false`); it is not in `render.yaml`.
The log will be removed once the setup is confirmed.

The client's CSP (`connect-src` in `client/vercel.json`) allows the API at
`https://clinicdesk-api-2uh0.onrender.com`. When the Render service URL changes,
`connect-src` in `client/vercel.json` must be changed too, otherwise the browser blocks all
API calls.

## API and data model

- Base URL (local): `http://localhost:3000/api/v1`
- API contract (OpenAPI 3): [`docs/openapi.yaml`](docs/openapi.yaml)
- Data model (ER diagram): [`docs/er-diagram.md`](docs/er-diagram.md)
- Roles and permissions: [`docs/roles-and-permissions.md`](docs/roles-and-permissions.md)
- Ticket status workflow: [`docs/status-workflow.md`](docs/status-workflow.md)
- Ticket assignment: [`docs/assignment.md`](docs/assignment.md)
- Comments and internal notes: [`docs/comments.md`](docs/comments.md)
- Ticket list filters, search and sorting: [`docs/ticket-list.md`](docs/ticket-list.md)
- Admin user management and the first admin: [`docs/user-management.md`](docs/user-management.md)
- Audit log: [`docs/audit-log.md`](docs/audit-log.md)
- Security review (OWASP Top 10): [`docs/security-review.md`](docs/security-review.md)
- Email notifications: [`docs/notifications.md`](docs/notifications.md); change request record: [`docs/change-requests/CD-21.md`](docs/change-requests/CD-21.md)
- SLA timer (targets, states, who sees them): [`docs/sla.md`](docs/sla.md); change request record: [`docs/change-requests/CD-22.md`](docs/change-requests/CD-22.md)
- Responsive layout and screenshots: [`docs/responsive/`](docs/responsive/README.md)

To view the API contract as interactive documentation, paste `docs/openapi.yaml` into [Swagger Editor](https://editor.swagger.io).

## Project management
Backlog and sprints are tracked on Trello (33 tickets, 3 sprints).

## Status
In development. Sprint 0 (foundation) in progress.

## Live demo
Coming soon

## Staging deployment

The staging topology is MongoDB Atlas Free, Render for the API, and Vercel for
the client. The API deployment is described by [`render.yaml`](render.yaml).

1. Create an Atlas free cluster and database user. Add the Render outbound
	network access as allowed by your Atlas IP access list; for a free Render
	instance without stable outbound IPs, Atlas may require `0.0.0.0/0`. Use a
	strong database password and keep the connection string private.
2. In Render, create a Blueprint from this repository and set `MONGODB_URI` to
	the Atlas connection string and `CLIENT_ORIGIN` to the final Vercel origin
	(for example, `https://clinicdesk.vercel.app`). The API health check is
	`/health`; its hello endpoint is `/api/v1/hello`.
	`render.yaml` sets `EMAIL_ENABLED=true` and `APP_URL=https://clinic-desk-sable.vercel.app`,
	so also set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in the
	Render dashboard (a Mailtrap sandbox on staging). **Until all of them are set, the API
	stops at startup** with an error that names the missing variables. To run without email,
	set `EMAIL_ENABLED=false` instead ([`docs/notifications.md`](docs/notifications.md)).
3. In Vercel, import the repository with `client` as the Root Directory. Set
	`VITE_API_URL` to the Render API origin (for example,
	`https://<your-api>.onrender.com`) for the Preview and Production
	environments, then deploy. The same origin must be listed in `connect-src` in
	`client/vercel.json`: when the Render service URL changes, `connect-src` must be
	changed too, otherwise the browser blocks all API calls ("Could not reach the
	ClinicDesk API").
4. Open `/health-check` on the Vercel deployment. The page should show `Hello from ClinicDesk API`,
	confirming the frontend can reach the deployed backend. `client/vercel.json`
	rewrites every path to `index.html` so client-side routes work on reload.
5. Open `/register` on the Vercel deployment, create an account, and check that
	you land on `/tickets` with your name and role in the header. Log out, then log
	back in at `/login`.
6. Create the first admin, once per environment: register the account that should
	become the admin, then set its `role` to `"admin"` in Atlas (**Browse Collections**,
	`users` collection). Log out and back in. This is the only manual role change. All
	other agents, admins and role changes are handled in the app at `/admin/users`
	(**Users** in the top bar). There are no default credentials. See
	[`docs/user-management.md`](docs/user-management.md#creating-the-first-admin).

The Atlas connection string is staged for future database integration; the
current application does not yet connect to MongoDB. Configure secrets only in
the hosting dashboards, never in committed files. Render's free web service can
sleep when idle, so the first request after inactivity may take longer.