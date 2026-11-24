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

GitHub Actions runs the server lint and tests and the client lint, tests, and build
on pull requests targeting `main` and pushes to `main`.

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

The Atlas connection string is staged for future database integration; the
current application does not yet connect to MongoDB. Configure secrets only in
the hosting dashboards, never in committed files. Render's free web service can
sleep when idle, so the first request after inactivity may take longer.