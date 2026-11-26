# Ticket list: filters, search and sorting

`GET /api/v1/tickets` (see [`openapi.yaml`](openapi.yaml)) returns one page of tickets.
The tickets page in the client (`/tickets`) is a toolbar on top of this endpoint.

## Parameters

All parameters are optional.

| Parameter | Values | Default |
|---|---|---|
| `page` | Whole number, at least 1 | `1` |
| `limit` | Whole number, 1 to 50 | `10` |
| `status` | `open`, `in_progress`, `waiting`, `resolved`, `closed`, or a comma-separated list | All |
| `priority` | `low`, `normal`, `high`, `urgent`, or a comma-separated list | All |
| `category` | `it`, `facility`, `account`, `other`, or a comma-separated list | All |
| `assignee` | A user id, `me` or `unassigned`. **Agents and admins only** | All |
| `sla` | `breached` or `at_risk` (one value). **Agents and admins only** ([SLA](sla.md)) | All |
| `q` | Title search, 1 to 100 characters after trimming | None |
| `sort` | `createdAt`, `updatedAt`, `priority`, `status` | `createdAt` |
| `order` | `asc`, `desc` | `desc` |

Different filters are combined with AND; the values of one list with OR. For example
`?status=open,waiting&priority=urgent` returns urgent tickets that are open or waiting.

The response is `{ items, page, limit, total, totalPages }`; `total` and `totalPages`
count the filtered tickets. A page past the end returns an empty `items` array.

### SLA filter

`sla=breached` or `sla=at_risk` returns the tickets in that SLA state at the time of the
request, using the same rules as the `sla` object on each ticket ([SLA](sla.md)). The
condition is built by the server from the stored due dates and the server's clock
(`server/src/sla/query.js`); no request value reaches it. It is part of the same filter as
everything else, so it combines with the other filters, the search, sorting and paging, and
`total` counts only matching tickets. Tickets created before CD-22 have no SLA and never
match. `breached` includes tickets that were resolved late; add `status=open,in_progress,waiting`
to see only the ones that still need work. There is no index for this filter: it reads the
tickets left after the other filters, which is fine at ClinicDesk's size.

### Title search

`q` is a case-insensitive "contains" match on the title: `printer` finds
"Laser PRINTER toner low". The text is matched literally. The server escapes every
regular expression character before it builds the query, so `.*` only finds titles that
contain `.*`, `(` is not an error, and no input can make the pattern slow (ReDoS).

The search reads every ticket left after the other filters (and the customer scope). That
is fine at ClinicDesk's size (one clinic, thousands of tickets). If the list grows to
hundreds of thousands of tickets, a MongoDB text index or Atlas Search is the next step.

## Sorting

- `createdAt` and `updatedAt` sort by date.
- `priority` sorts by meaning: low < normal < high < urgent. `desc` puts urgent first.
- `status` sorts by workflow order: open < in_progress < waiting < resolved < closed.
  `asc` puts open first.
- Within the same priority or status, the newest ticket comes first.
- `_id` is always the last sort key, so tickets with the same values keep the same order
  and no ticket appears on two pages or is skipped.

## Errors

Checks run in this order:

1. **400 VALIDATION_ERROR**: a value outside the lists above, an empty value (`status=`),
   an unknown parameter, a repeated parameter (`status=a&status=b`), or an operator form
   such as `status[$ne]=closed` or `$where=1`. Each problem has its own entry in
   `details`, with the parameter name as sent in `field`.
2. **403 FORBIDDEN**: a customer sent `assignee` or `sla`.

## What the customer scope guarantees

- A customer only ever receives tickets they created. The scope (`createdBy` = the
  logged-in user) is added by the server after all filters, so no filter can replace it.
- Filters and search only narrow the customer's own tickets. A search or filter that
  matches another customer's ticket returns nothing, and `total` does not count it.
- A customer cannot filter by assignee or SLA (403), and `createdBy` is not a parameter (400).
- No request value is used as a MongoDB key or operator: enum values come from fixed lists,
  ids are checked and converted by the server, and the search text is an escaped literal.
- `items` and `total` use the same filter, so the count never leaks tickets that the page
  would not show.

Tests: `server/tests/ticketList.test.js`.

## Indexes

Besides `{ createdBy, createdAt }` (a customer's own list) and `{ createdAt }`, the
`Ticket` model has `{ status, createdAt, _id }` and `{ assignee, createdAt, _id }` for the
most common staff views: the queue by status, "my tickets" and "unassigned". Sorting by
priority or status ranks the tickets in the query, which is fine at this size.

## Client

- The toolbar has a search box (applied after a 300 ms pause, or at once with Enter), and
  selects for status, priority and category. Agents and admins also get an assignee select
  (All, Me, Unassigned), an SLA select (All, Breached, Due soon) and a "Sort by" select.
- Agents and admins see an SLA column (a card row on phones) with a text badge ("On track",
  "Due soon", "Breached", "Met") and the due time in their locale. Customers see no SLA. "Clear filters" appears while a filter or
  search is active; it keeps the sort.
- Below the tablet breakpoint (640px, CD-36) the table is replaced by one card per
  ticket, and the "Sort by" select is shown to every role instead of the sortable headers
  ([responsive rules](design-tokens.md#breakpoints-and-responsive-rules)).
- The Status, Priority and Created column headers are buttons that sort the list. The
  active column has `aria-sort`; a second click reverses the direction.
- Page, filters, search and sort live in the URL (`/tickets?status=open&q=printer`), so
  refresh, the back button and shared links work. Changing a filter, the search or the sort
  goes back to page 1. "Back to tickets" on the detail page returns to the same list.
- Unknown values in the URL are ignored (shown as "All") instead of causing an error.
- A newer request aborts the older one, so fast typing never shows outdated results.
- "No tickets yet" is shown when there are no tickets at all; "No tickets match your
  filters", with a "Clear filters" button, when filters hide every ticket.
