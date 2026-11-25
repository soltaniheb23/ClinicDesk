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
3. In Vercel, import the repository with `client` as the Root Directory. Set
	`VITE_API_URL` to the Render API origin (for example,
	`https://clinicdesk-api.onrender.com`) for the Preview and Production
	environments, then deploy.
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