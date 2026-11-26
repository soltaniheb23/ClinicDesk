// Ticket email notifications (CD-21, docs/notifications.md): who gets an email, and what
// it says.
//
// The routes call notifyTicketCreated and notifyReply after the database write and do not
// wait for them, so the response never waits for SMTP. The returned promises never reject:
// a failure is logged with the ticket id, the event and the error code and message only,
// never a recipient address or message text. flush() waits for everything still running
// (tests use it to be deterministic).
const User = require('../models/User');
const { describeError, headerValue } = require('./mailer');

const STAFF_ROLES = ['agent', 'admin'];
const EXCERPT_LENGTH = 300;

const EVENTS = Object.freeze({
  ticketCreated: 'ticket_created',
  reply: 'reply',
});

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

// The first 300 characters of user text as plain text: line breaks kept (\r\n becomes \n),
// other control characters removed, an ellipsis when it was cut.
function excerpt(value) {
  const characters = Array.from(
    String(value ?? '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .trim(),
  );
  if (characters.length <= EXCERPT_LENGTH) return characters.join('');
  return `${characters.slice(0, EXCERPT_LENGTH).join('').trimEnd()}…`;
}

// The short ticket number shown to people: "#" and the last 6 characters of the id. The link
// always carries the full id.
function ticketNumber(ticketId) {
  return `#${String(ticketId).slice(-6).toUpperCase()}`;
}

function buildMessage({ heading, ticket, authorName, text, link, reason }) {
  const number = ticketNumber(ticket.id);
  const title = headerValue(ticket.title);
  const author = headerValue(authorName) || 'Someone';
  const body = excerpt(text);

  return {
    subject: `[ClinicDesk] ${heading} ${number}: ${title}`,
    text: [
      `${heading} ${number}: ${title}`,
      `From: ${author}`,
      '',
      body,
      '',
      `Open the ticket: ${link}`,
      '',
      reason,
    ].join('\n'),
    html: [
      '<!doctype html>',
      '<html><body style="font-family: sans-serif; line-height: 1.5;">',
      `<p><strong>${escapeHtml(heading)} ${escapeHtml(number)}: ${escapeHtml(title)}</strong></p>`,
      `<p>From: ${escapeHtml(author)}</p>`,
      `<p style="white-space: pre-wrap;">${escapeHtml(body)}</p>`,
      `<p><a href="${escapeHtml(link)}">Open the ticket</a></p>`,
      `<p style="color: #666; font-size: 12px;">${escapeHtml(reason)}</p>`,
      '</body></html>',
    ].join('\n'),
  };
}

function idOf(value) {
  if (!value) return null;
  return String(value._id ?? value.id ?? value);
}

// One entry per address, without the author (nobody is emailed about their own action).
function uniqueRecipients(users, authorId) {
  const seen = new Set();
  return users.filter((user) => {
    if (!user?.email || idOf(user) === authorId || seen.has(user.email)) return false;
    seen.add(user.email);
    return true;
  });
}

const RECIPIENT_FIELDS = 'email role isActive';

function findActiveUser(id) {
  if (!id) return null;
  return User.findOne({ _id: id, isActive: true }).select(RECIPIENT_FIELDS).lean();
}

function findActiveUsers(roles) {
  return User.find({ role: { $in: roles }, isActive: true })
    .select(RECIPIENT_FIELDS)
    .lean();
}

// A reply by an agent or admin goes to the ticket's customer. A reply by the customer goes
// to the assigned agent, or to every active agent when the ticket is unassigned (or its
// assignee was deactivated).
async function replyRecipients({ ticket, author }) {
  if (STAFF_ROLES.includes(author.role)) {
    const customer = await findActiveUser(idOf(ticket.createdBy));
    return customer ? [customer] : [];
  }

  const assignee = await findActiveUser(idOf(ticket.assignee));
  if (assignee) return [assignee];
  return findActiveUsers(['agent']);
}

// `mailer` comes from createMailer; `appUrl` is APP_URL without a trailing slash.
function createNotifier({ mailer, appUrl, logger = console }) {
  const pending = new Set();

  function logFailure(event, ticketId, { code, message }) {
    logger.error(
      `[notify] event=${event} ticket=${ticketId} failed: ${code}${message ? ` ${message}` : ''}`,
    );
  }

  async function deliver(event, ticketId, recipients, message) {
    const results = await Promise.all(
      recipients.map((recipient) => mailer.send({ ...message, to: recipient.email })),
    );
    const failed = results.filter((result) => !result.ok);
    for (const result of failed) logFailure(event, ticketId, result.error);
    return { event, sent: results.length - failed.length, failed: failed.length };
  }

  // Runs one notification in the background: tracked for flush(), never rejects.
  function run(event, ticketId, work) {
    if (!mailer.enabled) return Promise.resolve({ event, skipped: true });

    const task = (async () => {
      try {
        return await work();
      } catch (error) {
        logFailure(event, ticketId, describeError(error));
        return { event, sent: 0, failed: 0, error: true };
      }
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
    return task;
  }

  const linkTo = (ticketId) => `${appUrl}/tickets/${encodeURIComponent(ticketId)}`;

  // ticket: { id, title, description }; author: { id, name } (the user who created it).
  function notifyTicketCreated({ ticket, author }) {
    const ticketId = idOf(ticket);
    return run(EVENTS.ticketCreated, ticketId, async () => {
      const staff = await findActiveUsers(STAFF_ROLES);
      const recipients = uniqueRecipients(staff, idOf(author));
      const message = buildMessage({
        heading: 'New ticket',
        ticket: { id: ticketId, title: ticket.title },
        authorName: author.name,
        text: ticket.description,
        link: linkTo(ticketId),
        reason: 'You receive this email because you are an agent or admin in ClinicDesk.',
      });
      return deliver(EVENTS.ticketCreated, ticketId, recipients, message);
    });
  }

  // ticket: { id, title, createdBy, assignee } (ids or populated users);
  // comment: { body, internal }; author: { id, name, role }.
  // Internal notes never send an email.
  function notifyReply({ ticket, comment, author }) {
    const ticketId = idOf(ticket);
    if (comment.internal) return Promise.resolve({ event: EVENTS.reply, skipped: true });

    return run(EVENTS.reply, ticketId, async () => {
      const recipients = uniqueRecipients(await replyRecipients({ ticket, author }), idOf(author));
      const message = buildMessage({
        heading: 'New reply on',
        ticket: { id: ticketId, title: ticket.title },
        authorName: author.name,
        text: comment.body,
        link: linkTo(ticketId),
        reason: 'You receive this email because of your role on this ClinicDesk ticket.',
      });
      return deliver(EVENTS.reply, ticketId, recipients, message);
    });
  }

  async function flush() {
    while (pending.size > 0) await Promise.allSettled([...pending]);
  }

  return { enabled: mailer.enabled, notifyTicketCreated, notifyReply, flush };
}

module.exports = { EVENTS, createNotifier, escapeHtml, excerpt, ticketNumber };
