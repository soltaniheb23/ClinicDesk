# Email notifications (CD-21)

ClinicDesk sends an email when a ticket is created and when someone replies. The code is in
`server/src/notifications/` (`mailer.js` sends, `notify.js` decides who gets what), and the
routes call it from `POST /api/v1/tickets` and `POST /api/v1/tickets/{id}/comments`.
Tests: `server/tests/notifications.test.js`.

## Events and recipients

| Event | Recipients | Not emailed |
|---|---|---|
| New ticket | Every **active agent and admin** | The ticket's author (a customer is never told about their own ticket; an agent who opens a ticket is not emailed either) |
| Public reply by an agent or admin | The ticket's **customer** (its creator), if the account is active | The author of the reply |
| Reply by the customer | The **assigned agent or admin**. If the ticket is unassigned, or the assignee was deactivated: every **active agent** | Admins (unless assigned), deactivated users, the author |
| Internal note (`internal: true`) | **Nobody, ever** | Everyone |

- Each recipient gets their own message with one address in `To`, so recipients never see
  each other's addresses.
- Deactivated users never get an email.
- Status changes and assignments send no email in this version (see
  [`change-requests/CD-21.md`](change-requests/CD-21.md)).

## What an email contains

- **Subject:** `[ClinicDesk] New ticket #3F9A1C: <title>` or
  `[ClinicDesk] New reply on #3F9A1C: <title>`. The ticket number is `#` and the last 6
  characters of the ticket id. The link always uses the full id.
- **Who wrote:** the author's name.
- **Excerpt:** the first 300 characters of the description or reply, as plain text. Line
  breaks are kept, other control characters are removed, and `…` marks a cut.
- **Link:** `APP_URL` + `/tickets/<id>`, the ticket page in the client.
- A text part and an HTML part. The HTML part escapes all user text (`<`, `>`, `&`, `"`, `'`),
  so a title like `<script>` or a name like `<img onerror=…>` shows as text.

Never included: passwords or hashes, tokens, other users' email addresses, the author's email,
internal notes, status or assignment history, or any data beyond the fields above.

## Configuration

Everything comes from environment variables (see `server/.env.example`; never commit real
values).

| Variable | Default | Meaning |
|---|---|---|
| `EMAIL_ENABLED` | `false` | `true` turns sending on. Anything other than `true` or `false` stops the server at startup. |
| `SMTP_HOST` | none | SMTP server, for example `sandbox.smtp.mailtrap.io` for staging. |
| `SMTP_PORT` | none | `587` (STARTTLS) or `465` (TLS). Whole number from 1 to 65535. |
| `SMTP_USER`, `SMTP_PASS` | none | SMTP credentials (secrets: set them in the hosting dashboard only). |
| `MAIL_FROM` | none | Sender, for example `ClinicDesk <no-reply@example.com>`. One line, with an `@`. |
| `APP_URL` | none | The client's URL for links, for example `https://clinicdesk.vercel.app`. http(s), no credentials, query or fragment; a trailing slash is removed. |

When `EMAIL_ENABLED=true`, **all six** are required. A missing one, a bad port, a multi-line
`MAIL_FROM` or an `APP_URL` that is not an http(s) URL stops the server at startup with a clear
message (`server/src/config.js`).

With `EMAIL_ENABLED=false` (the default), nothing is sent and no recipient lookup runs. Under
`NODE_ENV=test`, no SMTP connection is ever opened: the tests inject a fake transport
(`createApp({ mailTransport })`).

On staging, use a sandbox such as Mailtrap, so real people never receive test emails.

## Failure behaviour

Sending is best effort:

- The route writes to the database first, then starts the notification **without waiting
  for it**, and answers. The status code and body are exactly the same whether mail works,
  fails or is off.
- The notification code never throws: transport errors and database errors during the
  recipient lookup are caught.
- A failure is logged with `console.error` as one line:
  `[notify] event=<ticket_created|reply> ticket=<ticket id> failed: <code> <message>`.
  Email addresses in the error message are replaced by `[address]`, and the message is cut
  to 200 characters. The recipient's address and the email text are never logged.
- There is no retry and no queue. A failed email is not sent later.
- SMTP timeouts are 10 s (connection, greeting) and 20 s (socket), so a slow server cannot
  keep work pending for minutes.

## Privacy and security notes

- **Header injection:** no user text reaches `From` or `To`. `To` comes from the database
  and `From` from `MAIL_FROM`. The subject contains the ticket title. Every header value has
  CR, LF and other control characters replaced by a space, both when the subject is built and
  again in the mailer, so a title like `Help\r\nBcc: x@example.com` stays one subject line.
- **HTML:** user text is escaped in the HTML part; the only link is the one built from
  `APP_URL` and the ticket id.
- **Local files and URLs:** the SMTP transport runs with `disableFileAccess` and
  `disableUrlAccess`, and no attachments are sent.
- **What leaves the system:** the recipient's address (to the SMTP provider) and the
  content above. Choose an SMTP provider you are allowed to share this with.
