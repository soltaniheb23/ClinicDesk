# Roles and permissions

ClinicDesk has three roles. New accounts from `/auth/register` are always
`customer`; only an admin can change a role (planned `PATCH /users/{id}`).

## How it is enforced

- `authenticate` (`server/src/auth/authenticate.js`) checks the bearer token and loads
  the user from the database. The role inside the token is ignored, so a role change or
  deactivation applies on the next request, even with an older token. Failures answer
  `401 UNAUTHENTICATED`.
- `requireRole(...roles)` (`server/src/auth/authorize.js`) answers `403 FORBIDDEN` when
  the user's role is not in the list.
- `canAccessOwnedResource(user, ownerId)` lets agents and admins through and customers
  only for their own resources. Ticket routes (CD-11) will answer `404` rather than `403`
  for tickets a customer may not see, so ticket IDs are not revealed.

Every protected route is tested against every role (and against missing, expired and
deactivated-user tokens and other customers' tickets) in
`server/tests/routeAccess.test.js`.

## What each role may do

The ticket, comment, attachment, user and admin endpoints are planned; this table is the
target behaviour for them.

| Action | Customer | Agent | Admin |
|---|---|---|---|
| Register, log in, view own profile (`/auth/me`) | Yes | Yes | Yes |
| Create a ticket | Yes | Yes | Yes |
| List and view tickets | Own only | All | All |
| Filter, search and sort the ticket list ([ticket list](ticket-list.md)) | Own only, any filter | All | All |
| Filter the list by assignee (`me`, `unassigned`, a user id) | No (403) | Yes | Yes |
| Comment on a ticket ([comments](comments.md)) | Own tickets, not closed | All, not closed | All, not closed |
| Write and read internal notes | No (403, never returned) | Yes | Yes |
| Upload and download attachments | Own tickets | All | All |
| Change ticket status ([workflow](status-workflow.md)) | Close own resolved ticket | Yes | Yes |
| Assign or claim a ticket ([assignment](assignment.md)) | No | Claim, or release own | Any active agent or admin |
| Manage users (create, change role, deactivate) | No | No | Yes |
| View audit log | No | No | Yes |
| View metrics dashboard | No | No | Yes |
