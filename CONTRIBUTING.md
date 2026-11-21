# Contributing to ClinicDesk

## Workflow
1. Pick a ticket from the Trello board and move it to **In Progress**.
2. Create a branch from an up-to-date `main`.
3. Commit small, focused changes.
4. Open a pull request using the template.
5. Wait for green CI checks and review, then merge.
6. Move the ticket to **Done** with a comment that links the PR.

Nobody pushes directly to `main`. It is protected by a ruleset.

## Branch naming
`feature/CD-12-short-name`, `fix/CD-30-login-bug`, `docs/CD-31-readme`

## Commit messages
`CD-12: add ticket status validation`

Use the imperative mood ("add", not "added"), and start with the ticket ID.

## Before you open a PR
```bash
# server
cd server && npm run lint && npm test

# client
cd client && npm run lint && npm test && npm run build
```

## Definition of Done
- Reviewed PR merged into `main`
- CI green
- Acceptance criteria verified
- Tests added for new logic
- API docs updated
- Deployed to staging (once staging exists)
- No new high-severity security finding