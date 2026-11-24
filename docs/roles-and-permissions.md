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

## What each role may do

The ticket, comment, attachment, user and admin endpoints are planned; this table is the
target behaviour for them.

| Action | Customer | Agent | Admin |
|---|---|---|---|
| Register, log in, view own profile (`/auth/me`) | Yes | Yes | Yes |
| Create a ticket | Yes | Yes | Yes |
| List and view tickets | Own only | All | All |
| Comment on a ticket | Own tickets | All | All |
| Write and read internal notes | No | Yes | Yes |
| Upload and download attachments | Own tickets | All | All |
| Change ticket status | Close own resolved ticket | Yes | Yes |
| Assign or claim a ticket | No | Yes | Yes |
| Manage users (create, change role, deactivate) | No | No | Yes |
| View audit log | No | No | Yes |
| View metrics dashboard | No | No | Yes |
