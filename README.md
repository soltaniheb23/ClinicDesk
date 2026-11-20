# ClinicDesk

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
