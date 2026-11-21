# ClinicDesk
<<<<<<< HEAD

[![CI](https://github.com/soltaniheb23/ClinicDesk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/soltaniheb23/ClinicDesk/actions/workflows/ci.yml)

ClinicDesk is a clinic helpdesk app with a React client and an Express API.

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
=======
Full-stack helpdesk and ticketing app for a clinic, built with the MERN stack. Features role-based access (customer, agent, admin), ticket workflow, comments, audit log, email notifications, and SLA tracking. Developed in sprints with CI/CD, code reviews, and documentation.


A helpdesk and ticketing platform for a small clinic, built as a simulation of a real
software project: sprints, tickets, pull requests, CI/CD, and a client change request.

## Problem
Clinic staff send support requests by phone and email, and requests get lost.
ClinicDesk gives them one place to create, track, and resolve tickets.

## Features
- Role-based access: Customer, Agent, Admin
- Ticket workflow: Open > In Progress > Waiting > Resolved > Closed
- Comments, internal notes, and file attachments
- Agent dashboard with filters and search
- Email notifications and SLA timers
- Audit log of important actions

## Tech stack
React, Vite, Tailwind CSS · Node.js, Express · MongoDB Atlas · Jest, Supertest, Playwright ·
GitHub Actions · Vercel, Render · Sentry

## Project management
Backlog and sprints are tracked on Trello (33 tickets, 3 sprints).

## Status
In development. Sprint 0 (foundation) in progress.

## Live demo
Coming soon
>>>>>>> origin/main
