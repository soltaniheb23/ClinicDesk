# Ticket comments

Enforced by `GET` and `POST /api/v1/tickets/{id}/comments` (see
[`openapi.yaml`](openapi.yaml)); the model is `server/src/models/Comment.js`.

## Rules

| Action | Customer | Agent | Admin |
|---|---|---|---|
| Read comments | Own tickets, public only | All, including internal notes | All, including internal notes |
| Post a comment | Own tickets | All tickets | All tickets |
| Post an internal note (`internal: true`) | No (403) | Yes | Yes |
| Comment on a closed ticket | No (409) | No (409) | No (409) |

- Customers never receive internal notes: the database query itself leaves them out
  (`internal: false`), they are not loaded and filtered afterwards.
- The thread is sorted oldest first (`createdAt`, then `_id` for equal timestamps).
- `author`, `ticket` and `createdAt` always come from the server. Unknown keys in the body
  (`author`, `createdAt`, `isInternal`, ...) are ignored.
- `body` is trimmed and must be 1 to 2000 characters.
- Authors are returned as `{ id, name, role }`; emails never leave the server.

## Order of checks for POST

1. **404 NOT_FOUND**: invalid id, unknown ticket, or another customer's ticket (same body
   as `GET /tickets/{id}`).
2. **400 VALIDATION_ERROR**: `body` missing, empty after trimming, over 2000 characters,
   or `internal` not a boolean.
3. **403 FORBIDDEN**: a customer sends `internal: true`.
4. **409 TICKET_CLOSED**: the ticket is closed.
5. **201** with `{ comment }`.

`GET` only has the 404 (and 401) cases and returns `{ items }`.

## First response (`firstResponseAt`)

The first **non-internal** comment by an **agent or admin** sets the ticket's
`firstResponseAt` to that comment's `createdAt`. The update filters on
`firstResponseAt: null`, so it is set once, even when two agents reply at the same time,
and later replies never overwrite it. Internal notes and customer comments never set it,
and status changes do not touch it. It stops the SLA first-response timer ([SLA](sla.md)).

## Email notifications

A public comment emails the other side of the ticket; an internal note never sends an
email. See [`notifications.md`](notifications.md).

## In the client

The ticket page shows the thread below the description: author name, role label
(Customer, Agent, Admin), date and time (`dd.mm.yyyy, hh:mm`) and the text as plain text
with line breaks kept. Internal notes have an "Internal note" badge and an amber
background. Agents and admins see an "Internal note" checkbox in the form; customers do
not. Closed tickets show the thread with a short note instead of the form.
