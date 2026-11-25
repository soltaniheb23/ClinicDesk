# Audit log (CD-20)

The audit log records who did what and when for security-relevant actions. Admins can
read it. Nobody can change or delete it.

- Model: `server/src/models/AuditLog.js` (the `AUDIT_LOG` entity in
  [`er-diagram.md`](er-diagram.md))
- Writing: `recordAudit()` in `server/src/audit/record.js`, called by the routes that act
- Reading: `GET /api/v1/audit-logs` (`server/src/routes/auditLogs.js`, contract in
  [`openapi.yaml`](openapi.yaml))
- UI: `/audit-log` (`client/src/pages/AuditLogPage.jsx`), linked as **Audit log** in the
  top bar for admins only
- Tests: `server/tests/auditLog.test.js`, `server/tests/routeAccess.test.js`,
  `client/src/pages/AuditLogPage.test.jsx`

## What is recorded

An entry is written only **after the action succeeded**. A rejected request (400, 401 on a
protected route, 403, 404 or 409) writes nothing. The one exception is a failed login,
which is itself the event being recorded.

| Action | When | `actor` | Entity | `metadata` |
|---|---|---|---|---|
| `auth.login` | `POST /auth/login` succeeds | the user | user (themselves) | `{}` |
| `auth.login_failed` | `POST /auth/login` answers 401 (wrong password, unknown email or deactivated account) | `null` | user, `entityId: null` | `{ email }`: the attempted email, lowercase, at most 254 characters |
| `ticket.status_changed` | `PATCH /tickets/{id}/status` succeeds | who changed it | ticket | `{ from, to }`: status values, for example `open` and `in_progress` |
| `ticket.assignee_changed` | `PATCH /tickets/{id}/assignee` succeeds | who changed it | ticket | `{ from, to }`: each is `{ id, name }` or `null` (unassigned). The names are kept as they were at that moment. |
| `user.created` | `POST /users` succeeds | the admin | the new user | `{ role }` |
| `user.role_changed` | `PATCH /users/{id}` changes the role | the admin | the user | `{ from, to }`: role values |
| `user.active_changed` | `PATCH /users/{id}` deactivates or reactivates | the admin | the user | `{ from, to }`: `true` or `false` |

A `PATCH /users/{id}` that changes both role and active state writes two entries. Sending
the value a user already has writes none. If the last-admin safeguard undoes a change
(`409 LAST_ADMIN`), nothing is recorded.

A failed login does not record why it failed. The API gives the same answer for a wrong
password, an unknown email and a deactivated account, and the log keeps it that way.
Repeated failures for one email are still easy to spot with the `auth.login_failed` filter.

## What is never recorded

- Passwords, temporary passwords, password hashes or tokens
- Request bodies. `metadata` is built field by field from known values, never copied from
  the request.
- Anything about a failed login except the attempted email
- Reads (viewing tickets, lists or the audit log itself), comments and ticket creation.
  These are not part of CD-20.

## Append-only

Entries are created and read, never changed or deleted:

- There is no create, update or delete route. `PUT`, `PATCH` and `DELETE` on
  `/audit-logs/{id}` answer 404.
- The model throws `Audit log entries cannot be changed or deleted` for `updateOne`,
  `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete`,
  `deleteOne` and `deleteMany`, for the `findById...` variants, and for `save()`,
  `deleteOne()` and `updateOne()` on a loaded entry. Only `create()` and `insertMany()`
  work.
- Entries have `createdAt` only, no `updatedAt`.

Mongoose middleware cannot see `Model.bulkWrite` or the raw MongoDB driver. The app never
uses either on this collection; the tests use the driver only to clean up between tests.
Stronger protection belongs in the database: give the API's database user insert and find
rights only on `auditlogs`. In Atlas this is a custom role.

## Failures never break the action

`recordAudit()` catches every error, logs it with `console.error` and returns normally.
If the audit write fails, the login, status change, assignment or user change has already
succeeded and keeps its normal response. The tests check this by making
`AuditLog.create` throw.

## Reading the log

`GET /api/v1/audit-logs` is admin only. Every route checks in this order, and the first
failure answers:

1. `401 UNAUTHENTICATED`: missing, invalid or expired token, or a deactivated caller
2. `403 FORBIDDEN`: customers and agents, even with a bad query
3. `400 VALIDATION_ERROR`: an unknown, repeated or operator-style parameter, or a bad value

Parameters, all optional:

- `page` and `limit`: from 1, and from 1 to 50 (default 10), as on the other lists
- `action`
- `actor`: a user id
- `entityType`: `user` or `ticket`
- `from` and `to`: inclusive. Either an ISO date-time with a time zone, or a plain date
  read as UTC. A plain `to` date covers that whole day. `to` before `from` is a 400.

The response is `{ items, page, limit, total, totalPages }`, newest first, with `_id` as the
tie-breaker. Each item is `{ id, actor, action, entityType, entityId, entityLabel, metadata,
createdAt }`:

- `actor` is `{ id, name }` or `null`. It never includes the email or `passwordHash`.
- `entityLabel` is the user's current name or the ticket's title, looked up when the log is
  read. It is `null` if that user or ticket no longer exists.

Indexes: `{ createdAt: -1, _id: -1 }` for the plain list, and
`{ actor: 1, createdAt: -1, _id: -1 }` and `{ action: 1, createdAt: -1, _id: -1 }` for the
two most common filters.

## The page

- Filters for action, from date and to date, kept in the URL (`?action=&from=&to=`). The
  dates are whole days in the viewer's own time zone: the page sends local midnight to
  23:59:59.999 as UTC date-times. A reversed range is shown as an error on the "To" field
  and is not sent.
- A table from the tablet breakpoint (`40em`), with Time, Who, Action, Target and Details.
  Below it, one card per entry. Only one of the two is rendered.
- Times are shown in the viewer's own locale format (`toLocaleString`), inside `<time
  datetime>`.
- Ticket targets link to the ticket.
- Loading, error with retry, empty, no-match and past-the-last-page states.
