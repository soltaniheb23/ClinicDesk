# User management (CD-19)

Admins create accounts, change roles, and deactivate or reactivate users. Customers
still register themselves at `/register`. Agents and admins are created here.

- API: `GET /api/v1/users`, `POST /api/v1/users`, `PATCH /api/v1/users/{id}`
  (`server/src/routes/users.js`, contract in [`openapi.yaml`](openapi.yaml))
- UI: `/admin/users` (`client/src/pages/UsersPage.jsx`), linked as **Users** in the top
  bar for admins only
- Tests: `server/tests/users.test.js`, `server/tests/routeAccess.test.js`,
  `client/src/pages/UsersPage.test.jsx`

## Rules

| Endpoint | What it does |
|---|---|
| `GET /users` | Paginated list (`page`, `limit` from 1 to 50, same rules as the ticket list). Optional filters: `role`, `isActive` (`true`/`false`) and `q` (name or email, case-insensitive, matched literally, 1 to 100 characters). Sorted by name, ignoring case, then `_id`. |
| `POST /users` | Body `name`, `email`, `password`, `role` (`customer`, `agent` or `admin`). Same name, email and password rules as `/auth/register` (password 8 characters to 72 bytes, hashed with bcrypt). New accounts are always active. No token is returned. |
| `PATCH /users/{id}` | Body `role` and/or `isActive` (at least one). |

All three are admin only. Responses contain only `id`, `name`, `email`, `role`,
`isActive` and `createdAt`. The serializer builds the response field by field, so
`passwordHash` can never be included. `GET /users/agents` (the assignee list) is unchanged
and still open to agents and admins.

## Safeguards

| Case | Answer |
|---|---|
| An admin changes their own role or active state (any `PATCH` on their own id) | `409 CANNOT_CHANGE_SELF` |
| The change would leave no active admin | `409 LAST_ADMIN`, and the change is undone |
| The user's role or active state changed between the read and the write | `409 USER_CONFLICT` |
| Email already used, in any letter case | `409 EMAIL_TAKEN` |

**Why the last-admin rule needs care.** The caller is always an active admin, and the
self rule means they are never the target. So outside a race there is always one other
active admin. The only way to reach zero is two admins demoting or deactivating each other
at the same time. The route handles this in two steps:

1. The write is a `findOneAndUpdate` whose filter includes the role and active state the
   checks were made on. If someone changed the user in the meantime, nothing is written
   and the answer is `USER_CONFLICT`.
2. If the write took an active admin away, the route counts active admins afterwards. If
   none are left, it undoes its own write and answers `LAST_ADMIN`.

Each request checks after its own write, so of two crossing requests at least one sees
zero and undoes its change. There is never a lasting state without an active admin. Both
cases are tested, the second one with real concurrent requests.

## Order of checks

Every admin route checks in this order, and the first failure answers:

1. `401 UNAUTHENTICATED`: missing, invalid or expired token, or a deactivated or deleted
   caller
2. `403 FORBIDDEN`: the caller is not an admin (customers and agents, even with a bad body)
3. `400 VALIDATION_ERROR`: bad query or body
4. `404 NOT_FOUND` (`PATCH` only): the id is not valid or no such user exists
5. `409`: one of the safeguards above

## Effect on sessions

`authenticate` loads the role and `isActive` from the database on every request and never
trusts the role inside the token, so:

- A **deactivated** user's existing token gets `401` on the very next request. The client
  logs them out on that 401.
- A **role change** applies on the next request with the same token. A demoted admin loses
  admin routes at once.
- A deactivated user **cannot log in**. They get the same `401 INVALID_CREDENTIALS` as for a
  wrong password, so the answer does not reveal that the account exists.
- **Reactivating** restores login with the old password.

Tickets assigned to a deactivated agent stay assigned. The admin's assignee select still
shows them, so the ticket can be reassigned.

## The UI

- Filter toolbar: search (name or email), role, status (active or deactivated). Filters
  and page live in the URL, like the ticket list.
- From the desktop breakpoint (`64em`) users are shown in a table. Below it they are shown
  as cards, because every row has controls that need the room. Only one of the two is
  rendered.
- **New user** opens the "Create user" form (name, email, temporary password, role).
  Duplicate emails and other server errors appear in a `role="alert"` message.
- Each row has a role select with **Save**, and **Deactivate** or **Reactivate** with a
  confirmation step. Focus moves to **Cancel**, the safe choice. Server refusals such as
  `LAST_ADMIN` appear in a `role="alert"` message in that row. Focus goes back to the
  button after **Cancel** or a refusal, and to the same control after a save (see
  [Focus management](testing.md#focus-management)).
- Your own row is marked **You** and has no controls.
- `/admin/users` is behind `ProtectedRoute roles={['admin']}`. Other roles are sent to
  `/tickets`. This only hides the page: the API checks the role again on every request.

There is no password change or reset yet. The temporary password stays until such a
feature exists, so give it to the person directly and never by email.

## Creating the first admin

The repository has no default admin, seed account or hard-coded credentials. Anyone who
registers is a `customer`. The first admin is promoted by hand **once per environment**,
directly in the database:

1. Register normally at `/register` with the account that should become the admin.
2. In MongoDB Atlas, open **Browse Collections** and find the `users` collection of the
   ClinicDesk database. Locally, use `mongosh` with your `MONGODB_URI`.
3. Find the document with that email and set `role` to `"admin"`. In `mongosh`:

   ```js
   db.users.updateOne({ email: '<the email you registered>' }, { $set: { role: 'admin' } })
   ```

4. Log out and log in again, so the client stores the new role. **Users** appears in the
   top bar.

After that, create and promote all other admins, agents and customers at `/admin/users`.
No further database edits are needed. Keep at least two active admins, so one can still
help if the other is locked out.
