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
**In use:** React, Vite, Node.js, Express, Jest, Supertest, Vitest, ESLint, Prettier, GitHub Actions

**Planned:** MongoDB Atlas, Tailwind CSS, Playwright, Vercel, Render, Sentry

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

## API and data model

- Base URL (local): `http://localhost:3000/api/v1`
- API contract (OpenAPI 3): [`docs/openapi.yaml`](docs/openapi.yaml)
- Data model (ER diagram): [`docs/er-diagram.md`](docs/er-diagram.md)

To view the API contract as interactive documentation, paste `docs/openapi.yaml` into [Swagger Editor](https://editor.swagger.io).

## Project management
Backlog and sprints are tracked on Trello (33 tickets, 3 sprints).

## Status
In development. Sprint 0 (foundation) in progress.

## Live demo
Coming soon