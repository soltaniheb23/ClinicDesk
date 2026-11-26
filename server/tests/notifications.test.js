// Email notifications (CD-21, docs/notifications.md). Every test injects a fake transport,
// so nothing is ever sent over the network, and awaits notifier.flush() so the background
// sends have finished before it checks them.
const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const { signToken } = require('../src/auth/token');
const { createMailer, describeError, headerValue } = require('../src/notifications/mailer');
const {
  createNotifier,
  escapeHtml,
  excerpt,
  ticketNumber,
} = require('../src/notifications/notify');

const APP_URL = 'https://clinicdesk.example';
// Placeholders only, never real credentials.
const MAIL_ENV = {
  EMAIL_ENABLED: 'true',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'placeholder-user',
  SMTP_PASS: 'placeholder-pass',
  MAIL_FROM: 'ClinicDesk <no-reply@example.com>',
  APP_URL: `${APP_URL}/`,
};

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init(), Comment.init()]);
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([User.deleteMany({}), Ticket.deleteMany({}), Comment.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

function fakeTransport({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    sendMail: jest.fn(async (message) => {
      if (fail) {
        const error = new Error(`550 Mailbox ${message.to} unavailable`);
        error.code = 'EENVELOPE';
        throw error;
      }
      sent.push(message);
      return { messageId: `fake-${sent.length}` };
    }),
  };
}

function mailApp({ env = MAIL_ENV, transport = fakeTransport() } = {}) {
  const app = createApp({ env: { NODE_ENV: 'test', ...env }, mailTransport: transport });
  return { app, transport, flush: () => app.get('notifier').flush() };
}

let userCount = 0;
async function createUser(role, { name, isActive = true } = {}) {
  userCount += 1;
  const user = await User.create({
    name: name ?? `${role} ${userCount}`,
    email: `${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
    isActive,
  });
  return { user, id: user.id, email: user.email, token: signToken(user) };
}

// One customer, two active agents, one inactive agent and one admin.
async function createTeam() {
  const [customer, agentA, agentB, inactiveAgent, admin] = await Promise.all([
    createUser('customer'),
    createUser('agent'),
    createUser('agent'),
    createUser('agent', { isActive: false }),
    createUser('admin'),
  ]);
  return { customer, agentA, agentB, inactiveAgent, admin };
}

const TICKET = { title: 'Printer in reception', description: 'It shows error E-12.' };

function postTicket(app, token, body = TICKET) {
  return request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send(body);
}

function postComment(app, token, ticketId, body) {
  return request(app)
    .post(`/api/v1/tickets/${ticketId}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function ticketOf(owner, fields = {}) {
  return Ticket.create({ ...TICKET, createdBy: owner.user._id, ...fields });
}

const recipients = (transport) => transport.sent.map((message) => message.to).sort();

describe('new ticket', () => {
  it('emails every active agent and admin, once each, but not the customer', async () => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp();

    const response = await postTicket(app, team.customer.token);
    await flush();

    expect(response.status).toBe(201);
    expect(recipients(transport)).toEqual(
      [team.agentA.email, team.agentB.email, team.admin.email].sort(),
    );
    // One address per message: recipients never see each other.
    for (const message of transport.sent) expect(message.to).not.toContain(',');
  });

  it('has the ticket number, title, author, excerpt and link', async () => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp();

    const response = await postTicket(app, team.customer.token);
    await flush();

    const { id } = response.body.ticket;
    const [message] = transport.sent;
    const number = `#${id.slice(-6).toUpperCase()}`;
    expect(message.from).toBe('ClinicDesk <no-reply@example.com>');
    expect(message.subject).toBe(`[ClinicDesk] New ticket ${number}: Printer in reception`);
    expect(message.text).toContain(`From: ${team.customer.user.name}`);
    expect(message.text).toContain('It shows error E-12.');
    expect(message.text).toContain(`Open the ticket: ${APP_URL}/tickets/${id}`);
    expect(message.html).toContain(`<a href="${APP_URL}/tickets/${id}">Open the ticket</a>`);
  });

  it('does not email the agent who created the ticket', async () => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp();

    await postTicket(app, team.agentA.token);
    await flush();

    expect(recipients(transport)).toEqual([team.agentB.email, team.admin.email].sort());
  });

  it('contains no password hash, token, email address or other internal data', async () => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp();

    await postTicket(app, team.customer.token);
    await flush();

    for (const message of transport.sent) {
      const content = `${message.subject}\n${message.text}\n${message.html}`;
      expect(content).not.toContain('not-a-real-hash');
      expect(content).not.toContain(team.customer.token);
      expect(content).not.toContain(team.customer.email);
      expect(content).not.toContain('placeholder-pass');
      expect(Object.keys(message).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
    }
  });
});

describe('replies', () => {
  it.each(['agent', 'admin'])('a public reply by an %s emails the customer only', async (role) => {
    const team = await createTeam();
    const author = role === 'agent' ? team.agentA : team.admin;
    const ticket = await ticketOf(team.customer, { assignee: team.agentB.user._id });
    const { app, transport, flush } = mailApp();

    const response = await postComment(app, author.token, ticket.id, { body: 'We are on it.' });
    await flush();

    expect(response.status).toBe(201);
    expect(recipients(transport)).toEqual([team.customer.email]);
    const [message] = transport.sent;
    expect(message.subject).toBe(
      `[ClinicDesk] New reply on ${ticketNumber(ticket.id)}: Printer in reception`,
    );
    expect(message.text).toContain(`From: ${author.user.name}`);
    expect(message.text).toContain('We are on it.');
    expect(message.text).toContain(`${APP_URL}/tickets/${ticket.id}`);
  });

  it('a reply by the customer emails the assigned agent only', async () => {
    const team = await createTeam();
    const ticket = await ticketOf(team.customer, { assignee: team.agentB.user._id });
    const { app, transport, flush } = mailApp();

    await postComment(app, team.customer.token, ticket.id, { body: 'Any news?' });
    await flush();

    expect(recipients(transport)).toEqual([team.agentB.email]);
  });

  it('a reply by the customer on an unassigned ticket emails every active agent', async () => {
    const team = await createTeam();
    const ticket = await ticketOf(team.customer);
    const { app, transport, flush } = mailApp();

    await postComment(app, team.customer.token, ticket.id, { body: 'Any news?' });
    await flush();

    // Agents only: not the admin, not the deactivated agent.
    expect(recipients(transport)).toEqual([team.agentA.email, team.agentB.email].sort());
  });

  it('falls back to every active agent when the assignee was deactivated', async () => {
    const team = await createTeam();
    const ticket = await ticketOf(team.customer, { assignee: team.inactiveAgent.user._id });
    const { app, transport, flush } = mailApp();

    await postComment(app, team.customer.token, ticket.id, { body: 'Any news?' });
    await flush();

    expect(recipients(transport)).toEqual([team.agentA.email, team.agentB.email].sort());
  });

  it('does not email a deactivated customer', async () => {
    const team = await createTeam();
    const ticket = await ticketOf(team.customer);
    await User.updateOne({ _id: team.customer.user._id }, { isActive: false });
    const { app, transport, flush } = mailApp();

    expect((await postComment(app, team.agentA.token, ticket.id, { body: 'Hi' })).status).toBe(201);
    await flush();

    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it.each(['agent', 'admin'])('an internal note by an %s NEVER sends an email', async (role) => {
    const team = await createTeam();
    const author = role === 'agent' ? team.agentA : team.admin;
    const assigned = await ticketOf(team.customer, { assignee: team.agentB.user._id });
    const unassigned = await ticketOf(team.customer);
    const { app, transport, flush } = mailApp();

    for (const ticket of [assigned, unassigned]) {
      const response = await postComment(app, author.token, ticket.id, {
        body: 'Customer seems upset, escalate.',
        internal: true,
      });
      expect(response.status).toBe(201);
      expect(response.body.comment.internal).toBe(true);
    }
    await flush();

    expect(transport.sendMail).not.toHaveBeenCalled();
  });
});

describe('when email is off', () => {
  it.each([
    ['EMAIL_ENABLED unset', {}],
    ['EMAIL_ENABLED=false', { ...MAIL_ENV, EMAIL_ENABLED: 'false' }],
  ])('sends nothing with %s, even with a transport', async (_label, env) => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp({ env });
    const ticket = await ticketOf(team.customer);

    expect((await postTicket(app, team.customer.token)).status).toBe(201);
    expect((await postComment(app, team.agentA.token, ticket.id, { body: 'Hi' })).status).toBe(201);
    expect((await postComment(app, team.customer.token, ticket.id, { body: 'Hi' })).status).toBe(
      201,
    );
    await flush();

    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(app.get('notifier').enabled).toBe(false);
  });

  it('never creates an SMTP transport under NODE_ENV=test', () => {
    const createTransport = jest.spyOn(nodemailer, 'createTransport');

    const mailer = createMailer({ config: { enabled: true }, env: { NODE_ENV: 'test' } });

    expect(mailer.enabled).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe('failures are best effort', () => {
  it('keeps the status code and body when the transport fails', async () => {
    const team = await createTeam();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const failing = mailApp({ transport: fakeTransport({ fail: true }) });
    const working = mailApp();
    const ticket = await ticketOf(team.customer);

    const created = await postTicket(failing.app, team.customer.token);
    const replied = await postComment(failing.app, team.agentA.token, ticket.id, { body: 'Hi' });
    const reference = await postTicket(working.app, team.customer.token);
    await Promise.all([failing.flush(), working.flush()]);

    expect(failing.transport.sendMail).toHaveBeenCalled();
    expect(created.status).toBe(201);
    expect(Object.keys(created.body.ticket)).toEqual(Object.keys(reference.body.ticket));
    expect(replied.status).toBe(201);
    expect(replied.body.comment.body).toBe('Hi');
    expect(await Ticket.countDocuments()).toBe(3);
    expect(await Comment.countDocuments()).toBe(1);
  });

  it('logs the ticket id, event and error, never the address or message text', async () => {
    const team = await createTeam();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { app, flush } = mailApp({ transport: fakeTransport({ fail: true }) });
    const ticket = await ticketOf(team.customer);

    await postComment(app, team.agentA.token, ticket.id, { body: 'Secret reply text' });
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    const [line] = error.mock.calls[0];
    expect(line).toBe(
      `[notify] event=reply ticket=${ticket.id} failed: EENVELOPE 550 Mailbox [address] unavailable`,
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(team.customer.email);
    expect(logged).not.toContain('Secret reply text');
  });

  it('logs and carries on when the recipient lookup fails', async () => {
    const team = await createTeam();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Only the recipient lookup fails (populate also uses User.find).
    const find = User.find.bind(User);
    jest.spyOn(User, 'find').mockImplementation((filter, ...rest) => {
      if (filter?.role) throw Object.assign(new Error('database unavailable'), { code: 'EDB' });
      return find(filter, ...rest);
    });
    const { app, transport, flush } = mailApp();

    const response = await postTicket(app, team.customer.token);
    await flush();

    expect(response.status).toBe(201);
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      `[notify] event=ticket_created ticket=${response.body.ticket.id} failed: EDB database unavailable`,
    );
  });

  it('answers before the email is sent', async () => {
    const team = await createTeam();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    // Every send waits until the test opens the gate.
    const transport = { sendMail: jest.fn(() => gate) };
    const { app, flush } = mailApp({ transport });

    const response = await postTicket(app, team.customer.token);

    expect(response.status).toBe(201);
    release();
    await flush();
    expect(transport.sendMail).toHaveBeenCalledTimes(3);
  });
});

describe('header injection and HTML escaping', () => {
  it('strips CR and LF from the subject, so a title cannot add headers', async () => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp();

    const response = await postTicket(app, team.customer.token, {
      title: 'Help\r\nBcc: attacker@example.com\nX-Injected: yes',
      description: 'Body',
    });
    await flush();

    expect(response.status).toBe(201);
    for (const message of transport.sent) {
      expect(message.subject).not.toMatch(/[\r\n]/);
      expect(message.subject).toContain('Help Bcc: attacker@example.com X-Injected: yes');
      expect(message).not.toHaveProperty('bcc');
    }
    expect(recipients(transport)).not.toContain('attacker@example.com');
  });

  it('sanitises every header value the mailer sets', async () => {
    const transport = fakeTransport();
    const mailer = createMailer({
      config: { enabled: true, from: 'ClinicDesk <no-reply@example.com>\r\nBcc: x@example.com' },
      env: { NODE_ENV: 'test' },
      transport,
    });

    const result = await mailer.send({
      to: 'agent@example.com\r\nBcc: attacker@example.com',
      subject: 'Hi\r\n\r\n<html>',
      text: 'Line 1\nLine 2',
      html: '<p>x</p>',
    });

    expect(result).toEqual({ ok: true });
    const [message] = transport.sent;
    for (const field of ['from', 'to', 'subject']) expect(message[field]).not.toMatch(/[\r\n]/);
    expect(message.subject).toBe('Hi <html>');
    // Bodies keep their line breaks.
    expect(message.text).toBe('Line 1\nLine 2');
  });

  it('escapes the title, author name and text in the HTML part', async () => {
    const team = await createTeam();
    const author = await createUser('customer', { name: '<img src=x onerror=alert(1)>' });
    const { app, transport, flush } = mailApp();

    await postTicket(app, author.token, {
      title: '<b>Bold</b> & "quoted"',
      description: '<script>alert("x")</script>\n<a href="https://evil.example">click</a>',
    });
    await flush();

    // agentA, agentB and the admin (team is only there to be emailed).
    expect(team.admin).toBeDefined();
    expect(transport.sent).toHaveLength(3);
    const [message] = transport.sent;
    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<img');
    expect(message.html).not.toContain('<b>');
    expect(message.html).not.toContain('href="https://evil.example"');
    expect(message.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(message.html).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    // The plain-text part is plain text: nothing is interpreted there.
    expect(message.text).toContain('<script>alert("x")</script>');
  });

  it('cuts the text to its first 300 characters', async () => {
    const team = await createTeam();
    const { app, transport, flush } = mailApp();
    const description = `${'a'.repeat(300)}THE-REST-IS-NOT-SENT`;

    await postTicket(app, team.customer.token, { title: 'Long', description });
    await flush();

    const [message] = transport.sent;
    expect(message.text).toContain(`${'a'.repeat(300)}…`);
    expect(message.text).not.toContain('THE-REST');
    expect(message.html).not.toContain('THE-REST');
  });
});

describe('helpers', () => {
  it('excerpt keeps short text and line breaks, and removes control characters', () => {
    expect(excerpt('  Hello\r\nworld\u0007  ')).toBe('Hello\nworld');
    expect(excerpt(undefined)).toBe('');
    // Characters, not UTF-16 units: an emoji is never cut in half.
    expect(excerpt('😀'.repeat(301))).toBe(`${'😀'.repeat(300)}…`);
  });

  it('escapeHtml escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(escapeHtml(null)).toBe('');
  });

  it('headerValue and describeError', () => {
    expect(headerValue('a\r\nb\tc')).toBe('a b c');
    expect(describeError(new Error('Rejected <someone@example.com>: quota'))).toEqual({
      code: 'SEND_FAILED',
      message: 'Rejected <[address]>: quota',
    });
    expect(describeError('x'.repeat(300)).message).toHaveLength(200);
    expect(describeError(undefined)).toEqual({ code: 'SEND_FAILED', message: '' });
  });

  it('notifier skips everything when the mailer is off', async () => {
    const send = jest.fn();
    const notifier = createNotifier({ mailer: { enabled: false, send }, appUrl: APP_URL });

    await expect(
      notifier.notifyTicketCreated({ ticket: { id: 'a' }, author: { id: 'b' } }),
    ).resolves.toEqual({ event: 'ticket_created', skipped: true });
    await notifier.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('builds an SMTP transport from the settings outside tests', () => {
    const createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail: jest.fn() });

    const config = { enabled: true, host: 'smtp.example.com', user: 'u', pass: 'p' };
    expect(createMailer({ config: { ...config, port: 587 }, env: {} }).enabled).toBe(true);
    createMailer({ config: { ...config, port: 465 }, env: { NODE_ENV: 'production' } });

    expect(createTransport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'u', pass: 'p' },
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    expect(createTransport.mock.calls[1][0].secure).toBe(true);
  });
});
