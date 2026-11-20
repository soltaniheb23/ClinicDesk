# ClinicDesk

ClinicDesk is a monorepo with a React/TypeScript web client and an Express/TypeScript API.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+

## Setup

From the repository root:

```sh
npm install
cp .env.example .env
npm run dev
```

The client runs at <http://localhost:5173> and the API at <http://localhost:3000>.
The API health check is available at <http://localhost:3000/health>.

The shared `.env` file configures `PORT` and `VITE_API_URL`. Variables prefixed with
`VITE_` are included in the browser bundle and must not contain secrets.

## Useful commands

Run these from the repository root:

```sh
npm run build       # Build both workspaces
npm run lint        # Lint client, server, and shared configuration
npm run format      # Format supported files
npm run format:check
```

GitHub Actions runs the formatting check, linter, and both workspace builds on every
push and pull request.

## Repository layout

```text
client/  React app and Vite configuration
server/  Express API
```
