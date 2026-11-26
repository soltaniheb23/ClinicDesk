# SLA timer on tickets (CD-22)

Every new ticket gets two response-time targets from its priority. Agents and admins see on
the list and the detail page which tickets are on track, due soon or breached, and can
filter the list by it. Customers never see SLA data.

Code: [`server/src/sla/policy.js`](../server/src/sla/policy.js) (targets),
[`server/src/sla/state.js`](../server/src/sla/state.js) (`getSlaState`),
[`server/src/sla/query.js`](../server/src/sla/query.js) (the list filter).
Change request: [`change-requests/CD-22.md`](change-requests/CD-22.md).

## Policy

Calendar hours (24/7), not business hours.

| Priority | First response | Resolution |
|---|---|---|
| Urgent | 1 h | 4 h |
| High | 4 h | 24 h |
| Normal | 8 h | 72 h (3 days) |
| Low | 24 h | 120 h (5 days) |

The targets are one frozen object in `server/src/sla/policy.js`, **not env vars**. A change
is a reviewed commit with a test (`server/tests/slaPolicy.test.js` pins the table above),
and there is no second source that could disagree with it. If the clinic needs different
targets per environment later, they can move to env vars with a startup check in
`server/src/config.js`, like the other settings.

## Snapshot at creation

When a ticket is created (`POST /tickets`), the server stores

- `slaFirstResponseDueAt` = `createdAt` + first response hours
- `slaResolutionDueAt` = `createdAt` + resolution hours

for the ticket's priority at that moment. The dates are never recalculated: a later policy
change only affects new tickets. Values sent by the client for these fields are ignored.

Tickets created before CD-22 have no due dates. They have no SLA (`state: null`), show no
badge and never match the SLA filter. There is no backfill.

## What starts and stops the timers

| Timer | Starts | Stops |
|---|---|---|
| First response | `createdAt` | `firstResponseAt`: the first **public** reply by an agent or admin |
| Resolution | `createdAt` | `resolvedAt`: the ticket becomes resolved (or closed) |

- `firstResponseAt` is set once (CD-14). Internal notes and customer replies never set it.
  The update is guarded (`findOneAndUpdate` with `firstResponseAt: null`), so two agents
  replying at the same time cannot overwrite it. A second staff reply changes nothing.
- `resolvedAt` is set when the status becomes **resolved**, kept when it becomes
  **closed** (and set then if it is missing), and cleared when a resolved ticket is
  **reopened** (resolved → in progress). After a reopen the resolution timer runs again
  against the same due date. Status changes are guarded by the expected current status
  (409 `STATUS_CONFLICT` otherwise), see [status workflow](status-workflow.md).
- A ticket that is resolved without any public staff reply counts as answered at
  `resolvedAt`.
- No status pauses a timer, `waiting` included.

## States

`getSlaState(ticket, now)` returns `{ state, dueAt, kind }`. `now` is passed in, so tests use
a fixed clock.

| State | Badge | Meaning |
|---|---|---|
| `ok` | On track | The running timer has used less than 75% of its time |
| `at_risk` | Due soon | 75% or more of the time from `createdAt` to `dueAt` has passed, not yet due |
| `breached` | Breached | The running timer is past `dueAt`, or a target was missed |
| `met` | Met | Resolved, and both targets were met |
| `null` | (none) | No SLA: created before CD-22 |

`kind` is `first_response` until the first response, then `resolution`; `dueAt` is that
timer's due date. In order:

1. No due dates → `null`.
2. No first response yet → the first-response timer (`ok`, `at_risk` or `breached`).
3. First response after its due date → `breached`, `first_response`. **A missed target
   stays breached**, so a late answer never turns the badge back to "On track".
4. Resolved → `met` if resolved by `slaResolutionDueAt`, otherwise `breached` (`resolution`).
5. Otherwise → the resolution timer (`ok`, `at_risk` or `breached`).

A response or resolution exactly at the due date counts as on time.

## API

`sla` is part of every ticket in the list, the detail, the create response and the status
and assignment responses, **for agents and admins only**:

```json
"sla": { "state": "at_risk", "kind": "first_response", "dueAt": "2026-12-01T13:15:00.000Z" }
```

The due dates themselves (`slaFirstResponseDueAt`, `slaResolutionDueAt`) are never sent.

`GET /tickets?sla=breached` or `?sla=at_risk` (agents and admins) filters by state at the
time of the request. It combines with every other filter, the search, sorting and paging
([ticket list](ticket-list.md)). An unknown value is `400 VALIDATION_ERROR`; a customer
gets `403 FORBIDDEN`. The filter is a MongoDB `$expr` that mirrors `getSlaState`;
`server/tests/slaQuery.test.js` checks both against each other on the same tickets,
boundaries included.

## Who sees what

| | Customer | Agent | Admin |
|---|---|---|---|
| `sla` object on tickets | Never | Yes | Yes |
| `?sla=` filter | 403 | Yes | Yes |
| Badge, SLA column and SLA filter in the client | No | Yes | Yes |
| `firstResponseAt`, `resolvedAt` | Yes (as before) | Yes | Yes |

See [roles and permissions](roles-and-permissions.md#sla-data-is-internal).

## Client

- List: an SLA column on desktop and tablet, an SLA row in each card on phones, with the
  badge text and "First response due …" / "Resolution due …" ("was due" when breached) in
  the viewer's locale and time zone. Tickets without an SLA show nothing.
- Detail: the badge and due time next to the status and priority badges.
- Filter: an "SLA" select (All, Breached, Due soon) in the toolbar, stored in the URL
  (`?sla=breached`) like the other filters; "Clear filters" clears it too.
- The badge text carries the meaning; the colour only repeats it (WCAG 1.4.1).

## Known limits

- **Calendar hours only.** Nights, weekends and holidays count. Business hours need a
  clinic calendar and are a separate change.
- **No pause.** `waiting` (on the customer) does not stop the clock.
- **No email or alert on breach.** Agents see it in the list; notifications can reuse
  CD-21's mailer later.
- **Priority is fixed at creation.** There is no route to change a ticket's priority; if one
  is added, it must decide whether the due dates move.
- **The state is computed per request.** A page that stays open does not change from "On
  track" to "Due soon" until it is reloaded. A new reply on the detail page updates the
  badge after a reload (a status change updates it at once).
- **Reopen keeps the original due date**, so a ticket reopened late is breached at once.
- **`breached` includes finished tickets** that were resolved late. Combine with
  `status=open,in_progress,waiting` for the ones that still need work.
- **No index for the SLA filter.** It is evaluated on the tickets left after the other
  filters, which is fine at ClinicDesk's size.
- **The field is `firstResponseAt`** (from CD-14), not `firstRespondedAt` as in the ticket
  text, so no stored data or API field had to be renamed.
