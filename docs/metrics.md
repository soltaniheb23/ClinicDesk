# Team metrics (CD-23)

> As a support manager, I want a metrics page, so that I can see how the team is performing.

The **Metrics** page (`/metrics`, admins only) shows open tickets, the average resolution
time, SLA counts and tickets per agent, for a time range the admin picks.

- API: `GET /api/v1/metrics?range=7d|30d|90d|all` (`server/src/routes/metrics.js`,
  contract in [`openapi.yaml`](openapi.yaml))
- Computation: `server/src/metrics/compute.js`; range and rounding helpers in
  `server/src/metrics/range.js`
- Page: `client/src/pages/MetricsPage.jsx`; formatting in `client/src/metrics/format.js`
- Tests: `server/tests/metrics.test.js`, `server/tests/metricsRange.test.js`,
  `server/tests/routeAccess.test.js`, `client/src/pages/MetricsPage.test.jsx`,
  `client/src/metrics/format.test.js`

## Who can see it: admins only

**Decision: admin only, because the page compares colleagues.** Agents and customers get
`403 FORBIDDEN` from the API, see no **Metrics** link in the top bar, and are sent to
`/tickets` if they open `/metrics` (like the audit log). An agent can already see their own
workload on the ticket list with the `assignee=me` filter. Anyone without a token gets `401`.
See [roles and permissions](roles-and-permissions.md#metrics-are-admin-only).

## The range

`range` is a **rolling window that ends now**: `7d`, `30d` (the default) or `90d` whole
24-hour days, or `all` (no start).

- "Now" is the server's time when the request is handled, returned as `generatedAt`. The
  start is returned as `from` (`null` for `all`).
- Both ends are **inclusive**: a ticket resolved exactly at `from` or exactly at
  `generatedAt` counts; one resolved 1 ms earlier, or with a `resolvedAt` in the future,
  does not.
- The range **only applies to resolutions**: the average resolution time,
  `resolvedCount` and each agent's `resolvedInRange`. Open tickets and the SLA counts are
  always "right now".
- Any other value, an empty value, a repeated `range` or another parameter is
  `400 VALIDATION_ERROR` in the uniform error shape.
- On the page the range is in the URL (`/metrics?range=7d`), like the list filters. `30d` is
  left out of the URL, and an unknown value falls back to 30 days.

## The metrics

"Open" means **not finished**: every status except `resolved` and `closed`, so `open`,
`in_progress` and `waiting` ([status workflow](status-workflow.md)).

| Field | Definition |
|---|---|
| `openTickets.total` | Tickets whose status is `open`, `in_progress` or `waiting`, now. Not limited by the range. |
| `openTickets.byStatus` | The same, per status. All three keys are always there (0 when empty). |
| `resolution.resolvedCount` | Tickets whose `resolvedAt` is inside the range. `resolvedAt` is set when a ticket becomes `resolved`, kept when it is `closed`, and cleared when it is reopened, so this counts tickets that are resolved or closed now. |
| `resolution.averageHours` | The mean of `resolvedAt − createdAt` over those tickets, in hours, rounded to one decimal (half up). **`null` when no ticket was resolved in the range**: never 0, never NaN. |
| `perAgent[]` | One row for **every active agent and admin**, with zeros if they have no tickets, plus anyone else who **still holds open tickets**: a deactivated user, a deleted user (`name: null`), or a former agent whose role changed. Rows for users who are not active have `inactive: true`. |
| `perAgent[].openAssigned` | Open tickets assigned to that user now. |
| `perAgent[].resolvedInRange` | Tickets resolved in the range that are **assigned to that user now**. |
| `unassigned.open` | Open tickets without an assignee. |
| `sla.breachedOpen` | Open tickets whose SLA state is **Breached** now. |
| `sla.atRiskOpen` | Open tickets whose SLA state is **Due soon** (`at_risk`) now. |

`perAgent` is sorted by `openAssigned`, most first, then by name (case-insensitive), then by
id.

**SLA counts** use the same MongoDB condition as the ticket list's `?sla=breached` and
`?sla=at_risk` filters (`slaFilterExpression` in `server/src/sla/query.js`, which follows
`getSlaState` in `state.js`; see [SLA](sla.md)). So `breachedOpen` always equals the total
of `GET /tickets?sla=breached&status=open,in_progress,waiting`, and the test suite checks
exactly that. Tickets created before CD-22 have no SLA data and are never counted.

### Privacy

The response holds only counts, averages, user ids and the names of agents and admins (and
of anyone who still holds open tickets). It never contains ticket titles or descriptions,
emails, or customer ids or names. It is sent with `Cache-Control: private, no-store`.

## How it is computed

Everything is counted in MongoDB. One request runs **two aggregations and one user query**,
however many agents and tickets there are. No tickets are loaded into memory, and there is
no query per agent:

1. **Open tickets:** `$match` on `status ∈ {open, in_progress, waiting}`, then a `$facet`
   with counts by status, counts by assignee, and the two SLA counts (`$match` on the SLA
   `$expr` plus `$count`).
2. **Resolved in range:** `$match` on `resolvedAt` (`$gte from`, `$lte now`), then a `$facet`
   with the count and the sum of `resolvedAt − createdAt` (overall) and counts by assignee.
   The average is that sum divided by the count, computed only when the count is above 0.
3. **Users:** active agents and admins, plus the users who hold open tickets, by id from (1).
   Only `name`, `role` and `isActive` are read.

The time comes from the app's clock (`createApp({ clock })`). Tests pass a fixed time, as
the SLA code does with its `now` argument.

## Indexes

| Index | Why |
|---|---|
| `{ resolvedAt: 1 }` (**new**, `server/src/models/Ticket.js`) | "Resolved in the range" matches on `resolvedAt` alone. Every existing ticket index starts with another field, so without it the query read every ticket. With it, both the ranged query and `all` (`$lte now`) use `resolvedAt_1` (checked with `explain`; `metrics.test.js` asserts it for a ranged query). |
| `{ status: 1, createdAt: -1, _id: -1 }` (existing, CD-17) | Already serves the open-tickets `$match` on `status` (`explain` shows `status_1_createdAt_-1__id_-1`). Nothing new was needed. |

A `{ status, assignee }` index was **not** added: the open-tickets aggregation groups every
open ticket anyway, and the existing status index already limits it to open tickets.

## The page

- **Four summary cards:** Open tickets, Average resolution time, Breached, Due soon. Each
  has a text label and a one-line explanation. With no resolutions in the range, the
  average card says **"No resolved tickets in this range"** instead of a number.
- Durations up to 48 hours read as hours with one decimal (`5.5 h`). Above 48 hours they read
  as days and whole hours (`3 d 4 h`, or `3 d`), with the spoken form ("3 days 4 hours") for
  screen readers.
- **Open tickets by status:** a description list (Open, In progress, Waiting).
- **Tickets per agent:** a real `<table>` with a caption, column headers (Agent, Open
  assigned, Resolved in range) and the agent's name as the row header. The last row is
  **Unassigned** (open count; "Not counted" for resolved). Inactive users read
  "Name (inactive)", and deleted users read "Deleted user (inactive)". On phones the three
  short columns still fit (tighter cells, the wrapper scrolls if needed).
- **States:** a loading message; an error with **Try again**; and, when there are no open
  tickets and none were resolved in the range, **"No tickets to measure"** with a **Show
  all time** button.
- Each request has an `AbortController`, so a quick range change cancels the older request.
- No information is carried by color alone: every number has its label in text.

## Known limits

- **Calendar hours:** the resolution time counts nights and weekends, like the SLA timers
  ([SLA](sla.md)). Business hours need a clinic calendar.
- **Reopened tickets count by their latest `resolvedAt`.** A reopen clears `resolvedAt`, so
  a ticket is counted once, by its last resolution. The time spent before a reopen is part
  of the duration, because it runs from `createdAt`.
- **Credit goes to the current assignee.** `resolvedInRange` counts tickets by who they are
  assigned to now, not by who resolved them; there is no "resolved by" field yet. A
  reassignment after resolving moves the credit.
- **Users who leave:** a deactivated agent with no open tickets disappears from the table,
  together with their `resolvedInRange`. The overall `resolvedCount` still includes those
  tickets.
- **Resolved but unassigned** tickets count in the overall numbers but in no row.
- **No trends or charts:** the page shows one range at a time. Comparing periods or a chart
  per week is a later ticket.
- The average is a mean, so a few very old tickets resolved late can pull it up.
  A median would need `$percentile` (MongoDB 7) and is left for later.
