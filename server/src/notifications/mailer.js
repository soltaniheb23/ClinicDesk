// Sends email through SMTP (CD-21, docs/notifications.md).
//
// The mailer is "enabled" only when EMAIL_ENABLED is "true" and, under NODE_ENV=test, a
// transport was injected: tests never open a network connection. send() never throws. It
// resolves to { ok: true }, { ok: false, skipped: true } (mail is off) or
// { ok: false, error: { code, message } } (the transport failed).
const nodemailer = require('nodemailer');

// Every header value the mailer sets: CR, LF and other control characters become one space,
// so no text can start a new header line.
// eslint-disable-next-line no-control-regex
const HEADER_UNSAFE = /[\u0000-\u001f\u007f]+/g;
const EMAIL_PATTERN = /[^\s<>"'@]+@[^\s<>"'@]+/g;
const ERROR_MESSAGE_MAX_LENGTH = 200;

function headerValue(value) {
  return String(value ?? '')
    .replace(HEADER_UNSAFE, ' ')
    .trim();
}

// A transport error for the log: its code and a short message with email addresses
// removed (SMTP servers often quote the rejected recipient).
function describeError(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'SEND_FAILED';
  const message = headerValue(error?.message ?? error)
    .replace(EMAIL_PATTERN, '[address]')
    .slice(0, ERROR_MESSAGE_MAX_LENGTH);
  return { code, message };
}

function createSmtpTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Port 465 is SMTP over TLS; other ports (587) upgrade with STARTTLS.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    // Messages never read local files or URLs (no attachments are sent).
    disableFileAccess: true,
    disableUrlAccess: true,
    // A slow mail server must not keep work pending for minutes.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

// `config` comes from parseMailConfig (config.js). `transport` is any object with an async
// sendMail(message), such as a nodemailer transport or a fake in tests.
function createMailer({ config, env = process.env, transport } = {}) {
  const enabled = config?.enabled === true && (transport !== undefined || env.NODE_ENV !== 'test');
  if (!enabled) {
    return { enabled: false, send: async () => ({ ok: false, skipped: true }) };
  }

  const mailTransport = transport ?? createSmtpTransport(config);

  async function send({ to, subject, text, html }) {
    try {
      await mailTransport.sendMail({
        from: headerValue(config.from),
        to: headerValue(to),
        subject: headerValue(subject),
        text,
        html,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  return { enabled: true, send };
}

module.exports = { createMailer, describeError, headerValue };
