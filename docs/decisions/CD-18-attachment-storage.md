# Decision CD-18: store attachments in MongoDB GridFS

- **Ticket:** CD-18 "File attachments" (Epic E3 Tickets, 5 pts)
- **Decided:** Sprint 3, November 2026
- **Status:** accepted, implemented on `feature/CD-18-file-attachments`

## Context

> "As a customer, I want to attach files to a ticket, so that I can show the problem."

The Trello acceptance criteria say that the allowed types and the size limit are enforced on
the server, and that files are not executable and are never served from a public path
without an access check. The question this record answers is **where the bytes live**.

The deployment today: the API runs on Render's free web service, the data is in MongoDB
Atlas M0 (free), and the client is on Vercel. There is no object storage account.

## Options

| Option | For | Against |
|---|---|---|
| **Server disk** (`uploads/` on Render) | Simple, no new service | Render's free disk is **ephemeral**: every deploy or restart deletes the files. A path on disk is one misconfigured `express.static` away from being public, and a file on disk can end up executable. |
| **Public bucket** (S3, R2, Vercel Blob with public URLs) | Cheap, scales, no load on the API | A public URL skips the ticket access check: anyone with the link can read a patient's screenshot. Signed URLs would fix that but need a new account, keys and a second access path. |
| **MongoDB GridFS** (chosen) | Already there, nothing new to run or pay for. Survives deploys. Files are only reachable through the API, so every download goes through `authenticate` and the ticket access rule. The bytes are never on disk and never at a static path. | Uses the database's storage quota. Downloads go through the API process. |

## Decision

Store each file in **GridFS** (bucket `attachments`) under a **random filename** (a UUID),
with its metadata in an `Attachment` document (ticket, uploader, sanitised name, detected
type, size, GridFS id). Downloads only go through
`GET /api/v1/tickets/{ticketId}/attachments/{attachmentId}`, with the same access rule as the
ticket and `Content-Disposition: attachment`. Details: [attachments](../attachments.md).

## Trade-off: the Atlas M0 quota

Atlas M0 has **512 MB in total**, shared by tickets, comments, users, the audit log and now
the files. To keep this safe:

- The limits are small: **2 MB per file, 3 files per upload, 5 files per ticket**
  (`server/src/attachments/limits.js`). One ticket holds at most 10 MB.
- Only PNG, JPEG and PDF, checked by content.
- Deleting an attachment removes its GridFS file (`files` and `chunks`), not only the
  metadata.

**Risk:** about 50 tickets with the maximum of 5 × 2 MB fill the whole M0 database.
When the cluster is full, Atlas refuses **every** write, not only uploads: new tickets,
comments and audit entries would fail too. Watch the storage size in Atlas (**Metrics >
Data Size**) and act at 70%.

## Later option: object storage

When attachments outgrow M0, move the bytes to private object storage (for example S3 or
Cloudflare R2) and keep the `Attachment` documents:

- the bucket stays **private**; the API streams the file or answers with a short-lived signed
  URL, but only after the same access check;
- `gridFsId` becomes a storage key; a one-off script copies the existing files;
- the routes, the limits, the type check and the client stay the same.

Upgrading Atlas (M2/M5 or a paid tier) is the alternative that changes no code.

## Consequences

- No new service, account or secret for CD-18.
- The API process reads each upload into memory (at most 3 × 2 MB per request) before it
  writes it to GridFS. The upload rate limit keeps this bounded.
- No virus scanning and no image previews in this ticket ([attachments](../attachments.md#known-limits)).
