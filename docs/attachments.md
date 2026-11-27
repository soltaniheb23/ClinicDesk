# File attachments (CD-18)

> As a customer, I want to attach files to a ticket, so that I can show the problem.

Customers, agents and admins can attach screenshots, photos and PDFs to a ticket they can
see. Files are checked by their content, kept small, stored in MongoDB GridFS, and only ever
leave the server through an authenticated download route, always as a download.

- Storage decision: [`decisions/CD-18-attachment-storage.md`](decisions/CD-18-attachment-storage.md)
- Server: `server/src/routes/attachments.js`, `server/src/attachments/` (limits, type
  detection, filename, GridFS storage), `server/src/models/Attachment.js`
- Client: `client/src/tickets/AttachmentsSection.jsx` and `client/src/tickets/attachments.js`
  on the ticket detail page
- Contract: [`openapi.yaml`](openapi.yaml) (`/tickets/{id}/attachments…`)
- Tests: `server/tests/attachments.test.js`, `server/tests/attachmentHelpers.test.js`,
  `server/tests/routeAccess.test.js`, `client/src/tickets/AttachmentsSection.test.jsx`,
  `client/src/tickets/attachments.test.js`

## Limits and allowed types

All the numbers are in one object, `ATTACHMENT_LIMITS` in
`server/src/attachments/limits.js`. The client mirrors them in
`client/src/tickets/attachments.js` for its pre-check; the server always checks again.

| Limit | Value | Answer when exceeded |
|---|---|---|
| Size per file | 2 MB (2,097,152 bytes) | `413 FILE_TOO_LARGE` |
| Files per upload request | 3 | `400 TOO_MANY_FILES` |
| Attachments per ticket | 5 | `409 ATTACHMENT_LIMIT` |
| Stored name length | 100 characters | the name is shortened |
| Uploads per client | 20 per 15 minutes | `429 RATE_LIMITED` |

| Type | Detected by (first bytes) |
|---|---|
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` (the PNG signature) |
| `image/jpeg` | `FF D8 FF` |
| `application/pdf` | `25 50 44 46 2D` (`%PDF-`) |

Every error uses the uniform shape `{ "error": { "code", "message" } }`. When a request is
refused, **none** of its files are stored: everything is checked first, then written.

A closed ticket accepts no files (`409 TICKET_CLOSED`), like comments. Its existing files can
still be downloaded and deleted.

## How the type is decided

The server **ignores** the part's `Content-Type` and the file extension. `detectFileType()`
(`server/src/attachments/detectType.js`) compares the first bytes of the content with the
three signatures above. Anything else is refused with `400 UNSUPPORTED_FILE_TYPE`: a text
file named `.png`, an `.exe` renamed `.pdf`, HTML, SVG, GIF, ZIP-based Office files and
empty files.

The **stored type is the detected type**. A PNG uploaded as `report.pdf` with
`Content-Type: application/pdf` is stored as `image/png` and downloads as `report.pdf.png`.

## Filenames

The client's filename is stored only as display metadata, after `sanitizeFilename()`
(`server/src/attachments/filename.js`):

- only the part after the last `/` or `\` is kept, so no directories;
- control characters (including CR and LF), DEL and Unicode bidi controls are removed (bidi
  controls can make `invoice‮fdp.exe` look like `invoiceexe.pdf`);
- `< > : " | ? *` become `_`, and whitespace is collapsed;
- leading dots and spaces are removed (no hidden files, no `..`);
- the name must end in an extension of the **detected** type, otherwise one is added
  (`setup.exe` holding a PDF becomes `setup.exe.pdf`), so the saved file never opens as
  another kind of file;
- at most 100 characters, extension included; `attachment.<ext>` when nothing is left.

The name is **never used as a path**. In GridFS every file is named with a random UUID.

## Storage

Files are stored in **MongoDB GridFS** (bucket `attachments`: collections
`attachments.files` and `attachments.chunks`). They are never written to the server's disk
and never placed on a static or public path:

- multer uses **memory storage**. Its `fileSize` limit makes busboy stop reading a file at
  2 MB + 1 byte, so an oversized upload is cut off and never fully buffered;
- the buffer goes straight to GridFS. The test suite checks that `fs` write functions are
  never called during an upload and that no new file in the working directory or the temp
  directory contains the uploaded bytes.

**Quota risk:** Atlas M0 has 512 MB in total, shared with all other data. With the
limits, one ticket holds at most 10 MB, so about 50 full tickets would fill the cluster, and
then Atlas refuses **every** write. Watch **Metrics > Data Size** in Atlas. The way out
(private object storage, or a larger cluster) is described in the
[decision record](decisions/CD-18-attachment-storage.md).

## Access rules

| Action | Customer | Agent | Admin |
|---|---|---|---|
| List and download | Own tickets | All tickets | All tickets |
| Upload | Own tickets, not closed | All tickets, not closed | All tickets, not closed |
| Delete | Files they uploaded | Files they uploaded | Any file |

- Every route needs a bearer token (`401` without one).
- The ticket access rule is the same as for the ticket itself: an invalid id, an unknown
  ticket and **another customer's ticket all answer the same `404 Ticket not found`**.
- An attachment id that belongs to another ticket answers `404 Attachment not found`.
- A delete by someone who is neither the uploader nor an admin answers `403 FORBIDDEN`.

## Download headers

`GET /api/v1/tickets/{ticketId}/attachments/{attachmentId}` answers:

| Header | Value |
|---|---|
| `Content-Type` | the stored, detected type |
| `Content-Disposition` | `attachment; filename=…` with the sanitised name (plus `filename*=UTF-8''…` for non-ASCII names). Never `inline`. |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `private, no-store` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` (helmet, as on every API response) |

The client keeps the token in memory, so a plain `<a href>` cannot carry it. The page
downloads through the API client (`downloadAttachment()`, with the `Authorization` header),
gets a `Blob`, and saves it with a temporary `blob:` link with the `download` attribute.

**CSP:** no change to `client/vercel.json` is needed. The bytes come from the API origin,
which `connect-src` already allows, and following a `blob:` link to save a file is a
download, which no CSP directive controls. There are no image previews, so `img-src` stays
`'self'`.

How this was checked (November 2026): a page served with exactly the policy from
`client/vercel.json` fetched a PDF, made a `blob:` URL and clicked a temporary link with
`download`, in headless Firefox. The file was saved as `scan.pdf` and no
`securitypolicyviolation` event fired. As a control, the same page also loaded the `blob:`
URL as an `<img>`: that was blocked (`img-src`), so the listener worked and a preview would
need a CSP change.

## Audit log

Each stored file writes `ticket.attachment_added`, and each delete writes
`ticket.attachment_removed`: the actor, the ticket, and `metadata: { name }` (the sanitised
name). A refused upload writes nothing. See [audit log](audit-log.md).

## Client

The **Attachments** section sits on the ticket detail page between the description and the
comments:

- a file input that accepts `.png, .jpg, .jpeg, .pdf`, with the limits written under it;
- a pre-check of type, size, empty files and both counts, listing every problem in text and
  marking the input invalid. Upload stays disabled until the selection is fixed;
- while uploading, the button reads **Uploading...** and the input is disabled;
- the list shows the name, type, size, date and time, and uploader, with **Download**, and
  **Delete** (with a confirm step) where allowed;
- server errors show the `message` of the uniform error shape;
- a closed or full ticket shows a sentence instead of the form.

All controls are buttons or labelled inputs, so they work with the keyboard. States are
written out in text, never shown by color alone.

## Known limits

- **No virus or malware scanning.** Only the type is checked. A PDF can still carry harmful
  content (links, scripts for PDF readers). The download is never inline and the type is
  pinned with `nosniff`, but the file is opened by the user's own viewer.
- **No content check beyond the signature.** A file that starts with a valid signature
  followed by other data (a polyglot) is accepted. It is still only ever served as a download
  with its detected type.
- **No image previews or thumbnails.** That would need `img-src blob:` in the client's CSP.
- **No metadata stripping.** JPEG EXIF data (for example GPS position or camera details)
  stays in the file.
- **Concurrent uploads** to the same ticket can, in a narrow race, exceed 5 files (two
  requests counted at the same moment). The size of each file is still capped.
- **Quota:** see Storage. There is no per-user or total quota beyond the counts.
- **Memory:** each upload request holds at most 3 × 2 MB in memory while it is checked.
  The upload rate limit bounds how often one client can do that.
- If removing the GridFS file fails after a delete, the attachment is gone for users and the
  error is logged; the orphaned bytes stay in `attachments.chunks` until cleaned up by hand.
