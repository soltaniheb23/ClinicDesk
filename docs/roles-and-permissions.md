# Roles and permissions

ClinicDesk has three roles. New accounts from `/auth/register` are always
`customer`; only an admin can create accounts with another role or change a role
(`POST /users`, `PATCH /users/{id}`, see [user management](user-management.md)).

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

Every row is implemented and tested.

| Action | Customer | Agent | Admin |
|---|---|---|---|
| Register, log in, view own profile (`/auth/me`) | Yes | Yes | Yes |
| Create a ticket | Yes | Yes | Yes |
| List and view tickets | Own only | All | All |
| Filter, search and sort the ticket list ([ticket list](ticket-list.md)) | Own only, any filter | All | All |
| Filter the list by assignee (`me`, `unassigned`, a user id) | No (403) | Yes | Yes |
| See SLA state and due times (`sla` on tickets, [SLA](sla.md)) | No (never returned) | Yes | Yes |
| Filter the list by SLA (`sla=breached`, `sla=at_risk`) | No (403) | Yes | Yes |
| Comment on a ticket ([comments](comments.md)) | Own tickets, not closed | All, not closed | All, not closed |
| Write and read internal notes | No (403, never returned) | Yes | Yes |
| List and download attachments ([attachments](attachments.md)) | Own tickets | All | All |
| Upload attachments (PNG, JPEG, PDF; 2 MB, 3 per upload, 5 per ticket) | Own tickets, not closed | All, not closed | All, not closed |
| Delete an attachment | Files they uploaded | Files they uploaded | Any file |
| Change ticket status ([workflow](status-workflow.md)) | Close own resolved ticket | Yes | Yes |
| Assign or claim a ticket ([assignment](assignment.md)) | No | Claim, or release own | Any active agent or admin |
| Manage users: list, create, change role, deactivate ([user management](user-management.md)) | No (403) | No (403) | Yes, except their own account |
| View audit log ([audit log](audit-log.md), read only, nobody can edit or delete entries) | No (403) | No (403) | Yes |
| Send a Sentry test error (`POST /debug/sentry-test`, [monitoring](monitoring.md)) | No (403) | No (403) | Yes |
| View team metrics (`GET /metrics`, `/metrics`, [metrics](metrics.md)) | No (403) | No (403) | Yes |

## SLA data is internal

SLA targets, due dates and states (CD-22, [SLA](sla.md)) are for agents and admins. The
server adds the `sla` object to a ticket only when the user is an agent or admin, in every
ticket response (list, detail, create, status and assignment changes). For a customer it is
left out, and the stored due dates (`slaFirstResponseDueAt`, `slaResolutionDueAt`) are never
sent to anyone. A customer who sends `sla=` on the list gets `403 FORBIDDEN`. The client
shows no SLA badge, column or filter to customers. Tested in `server/tests/sla.test.js`.

`firstResponseAt` and `resolvedAt` are not SLA data: they are facts the customer already
sees in the thread and the status, and they stay in the customer's response as before.

## Metrics are admin only

The metrics page (CD-23, [metrics](metrics.md)) shows each agent's open and resolved
tickets side by side. **Decision: admin only, because the page compares colleagues.** Agents
get `403` from `GET /api/v1/metrics`, have no **Metrics** link, and are sent to `/tickets`
if they open `/metrics`. An agent's own workload is already on the ticket list
(`assignee=me`). Tested in `server/tests/metrics.test.js`, `server/tests/routeAccess.test.js`
and `client/src/pages/MetricsPage.test.jsx`.
