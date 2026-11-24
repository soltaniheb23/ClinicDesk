# Ticket assignment

Enforced by `PATCH /api/v1/tickets/{id}/assignee` (see [`openapi.yaml`](openapi.yaml)).
The ticket's `assignee` is always shown as `{ id, name }` or `null`; emails never leave
the server.

## Who may do what

| Action | Customer | Agent | Admin |
|---|---|---|---|
| See who a ticket is assigned to | Own tickets | All | All |
| Claim a ticket (`assignee` = own id) | No (403) | Yes, also from another agent | Yes |
| Release (`assignee` = `null`) | No (403) | Only when assigned to them | Yes |
| Assign someone else | No (403) | No (403) | Any active agent or admin |

Closed tickets cannot be reassigned (409). Status changes do not change the assignee,
and assigning does not change the status ([status workflow](status-workflow.md)).

## Responses

Checks run in this order:

1. **404 NOT_FOUND**: invalid id, unknown ticket, or another customer's ticket (same body
   as `GET /tickets/{id}`).
2. **403 FORBIDDEN**: the user is a customer.
3. **400 VALIDATION_ERROR**: `assignee` is missing or not a user id or `null`.
4. **400 VALIDATION_ERROR**: the user does not exist, is inactive, or is a customer
   ("Assignee must be an active agent or admin").
5. **403 FORBIDDEN**: an agent assigns someone else, or releases a ticket that is not
   assigned to them.
6. **409 TICKET_CLOSED**: the ticket is closed.
7. **409 ASSIGNEE_CONFLICT**: the assignee (or the status, to closed) changed between
   reading and saving. The update uses the assignee that was read as a condition, so it
   never silently overwrites someone else's change.

## Agent list

`GET /api/v1/users/agents` (agents and admins only) returns
`{ items: [{ id, name }] }` with the active agents and admins, sorted by name. The admin's
assignee select on the ticket page uses it.

## In the client

The ticket page shows "Assigned to <name>" or "Unassigned" to every role. Agents get an
"Assign to me" or "Unassign me" button; admins get a select with "Unassigned" and every
active agent and admin, plus a Save button. There is no control on closed tickets.
