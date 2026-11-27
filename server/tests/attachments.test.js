// Ticket attachments (CD-18, docs/attachments.md): upload, list, download and delete, with
// the type checked by content, the size and count limits, the ticket access rule, the
// download headers, the audit entries, and no file ever written to disk.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const { createApp } = require('../src/app');
const Attachment = require('../src/models/Attachment');
const AuditLog = require('../src/models/AuditLog');
const Ticket = require('../src/models/Ticket');
const User = require('../src/models/User');
const { signToken } = require('../src/auth/token');
const { ATTACHMENT_LIMITS } = require('../src/attachments/limits');

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};
const TICKET_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
const ATTACHMENT_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Attachment not found' } };

// Small files with real signatures; `marker` makes each one unique.
function png(marker = crypto.randomBytes(8)) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), marker]);
}
function jpeg(marker = crypto.randomBytes(8)) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), marker]);
}
function pdf(marker = crypto.randomBytes(8)) {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), marker]);
}

let mongoServer;
let app;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init(), Attachment.init(), AuditLog.init()]);
  app = createApp({ env: { NODE_ENV: 'test' } });
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    User.deleteMany({}),
    Ticket.deleteMany({}),
    Attachment.deleteMany({}),
    AuditLog.collection.deleteMany({}),
    gridFsFiles().deleteMany({}),
    mongoose.connection.db.collection('attachments.chunks').deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

function gridFsFiles() {
  return mongoose.connection.db.collection('attachments.files');
}

let userCount = 0;
async function createUser(role) {
  userCount += 1;
  const user = await User.create({
    name: `${role} ${userCount}`,
    email: `${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
  });
  return { user, id: user.id, name: user.name, token: signToken(user) };
}

async function setup() {
  const [owner, stranger, agent, otherAgent, admin] = await Promise.all([
    createUser('customer'),
    createUser('customer'),
    createUser('agent'),
    createUser('agent'),
    createUser('admin'),
  ]);
  const ticket = await Ticket.create({
    title: 'Printer in reception not working',
    description: 'It shows error E-12.',
    createdBy: owner.user._id,
  });
  return { owner, stranger, agent, otherAgent, admin, ticket, ticketId: ticket.id };
}

const base = (ticketId) => `/api/v1/tickets/${ticketId}/attachments`;

// files: [{ buffer, name, contentType }]
function upload(ticketId, actor, files, { field = 'files', to = app } = {}) {
  const pending = request(to).post(base(ticketId));
  if (actor) pending.set('Authorization', `Bearer ${actor.token}`);
  for (const file of files) {
    pending.attach(field, file.buffer, {
      filename: file.name,
      contentType: file.contentType ?? 'application/octet-stream',
    });
  }
  return pending;
}

function binary(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function download(ticketId, attachmentId, actor) {
  const pending = request(app)
    .get(`${base(ticketId)}/${attachmentId}`)
    .buffer(true)
    .parse(binary);
  if (actor) pending.set('Authorization', `Bearer ${actor.token}`);
  return pending;
}

function list(ticketId, actor) {
  const pending = request(app).get(base(ticketId));
  if (actor) pending.set('Authorization', `Bearer ${actor.token}`);
  return pending;
}

function remove(ticketId, attachmentId, actor) {
  const pending = request(app).delete(`${base(ticketId)}/${attachmentId}`);
  if (actor) pending.set('Authorization', `Bearer ${actor.token}`);
  return pending;
}

async function expectNothingStored() {
  expect(await Attachment.countDocuments()).toBe(0);
  expect(await gridFsFiles().countDocuments()).toBe(0);
}

describe('POST /tickets/:ticketId/attachments', () => {
  it.each([
    ['a PNG', png, 'screenshot.png', 'image/png'],
    ['a JPEG', jpeg, 'photo.jpg', 'image/jpeg'],
    ['a PDF', pdf, 'scan.pdf', 'application/pdf'],
  ])('stores %s for the ticket owner and answers 201', async (_label, make, name, type) => {
    const { owner, ticketId } = await setup();
    const buffer = make();

    const response = await upload(ticketId, owner, [{ buffer, name, contentType: type }]);

    expect(response.status).toBe(201);
    expect(response.body.items).toEqual([
      {
        id: expect.any(String),
        name,
        type,
        size: buffer.length,
        createdAt: expect.any(String),
        uploadedBy: { id: owner.id, name: owner.name },
      },
    ]);
    expect(await gridFsFiles().countDocuments()).toBe(1);
  });

  it('accepts up to 3 files in one request from agents and admins', async () => {
    const { agent, admin, ticketId } = await setup();

    const first = await upload(ticketId, agent, [
      { buffer: png(), name: 'a.png' },
      { buffer: jpeg(), name: 'b.jpeg' },
      { buffer: pdf(), name: 'c.pdf' },
    ]);
    const second = await upload(ticketId, admin, [{ buffer: pdf(), name: 'd.pdf' }]);

    expect(first.status).toBe(201);
    expect(first.body.items.map((item) => item.name)).toEqual(['a.png', 'b.jpeg', 'c.pdf']);
    expect(second.status).toBe(201);
    expect(await Attachment.countDocuments()).toBe(4);
  });

  it('stores the detected type, not the client Content-Type or extension', async () => {
    const { owner, ticketId } = await setup();

    const response = await upload(ticketId, owner, [
      { buffer: png(), name: 'report.pdf', contentType: 'application/pdf' },
    ]);

    expect(response.status).toBe(201);
    expect(response.body.items[0]).toMatchObject({ type: 'image/png', name: 'report.pdf.png' });
    const stored = await Attachment.findOne().lean();
    expect(stored.type).toBe('image/png');
  });

  it.each([
    ['a text file named .png', Buffer.from('just some text, honestly'), 'notes.png', 'image/png'],
    [
      'an .exe renamed .pdf',
      Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
      'invoice.pdf',
      'application/pdf',
    ],
    [
      'an HTML page named .jpg',
      Buffer.from('<html><script>alert(1)</script>'),
      'x.jpg',
      'image/jpeg',
    ],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml'],
    ['an empty file', Buffer.alloc(0), 'empty.png', 'image/png'],
  ])('rejects %s by its content and stores nothing', async (_label, buffer, name, contentType) => {
    const { owner, ticketId } = await setup();

    const response = await upload(ticketId, owner, [{ buffer, name, contentType }]);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `"${name}" is not a PNG, JPEG or PDF file. Only these types are allowed.`,
      },
    });
    await expectNothingStored();
  });

  it('stores none of the files when one of them is not allowed', async () => {
    const { owner, ticketId } = await setup();

    const response = await upload(ticketId, owner, [
      { buffer: png(), name: 'ok.png' },
      { buffer: Buffer.from('MZ fake exe'), name: 'bad.pdf' },
    ]);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    await expectNothingStored();
  });

  it('answers 413 for a file over 2 MB and stores nothing', async () => {
    const { owner, ticketId } = await setup();
    const tooLarge = Buffer.concat([png(), Buffer.alloc(ATTACHMENT_LIMITS.maxFileSize)]);

    const response = await upload(ticketId, owner, [{ buffer: tooLarge, name: 'big.png' }]);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: { code: 'FILE_TOO_LARGE', message: 'Each file must be at most 2 MB.' },
    });
    await expectNothingStored();
  });

  it('accepts a file of exactly 2 MB', async () => {
    const { owner, ticketId } = await setup();
    const signature = png(Buffer.alloc(0));
    const exact = Buffer.concat([signature, Buffer.alloc(ATTACHMENT_LIMITS.maxFileSize - 8)]);

    const response = await upload(ticketId, owner, [{ buffer: exact, name: 'exact.png' }]);

    expect(response.status).toBe(201);
    expect(response.body.items[0].size).toBe(ATTACHMENT_LIMITS.maxFileSize);
  });

  it('answers 400 for more than 3 files in one request and stores nothing', async () => {
    const { owner, ticketId } = await setup();

    const response = await upload(ticketId, owner, [
      { buffer: png(), name: '1.png' },
      { buffer: png(), name: '2.png' },
      { buffer: png(), name: '3.png' },
      { buffer: png(), name: '4.png' },
    ]);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'TOO_MANY_FILES', message: 'Upload at most 3 files at a time.' },
    });
    await expectNothingStored();
  });

  it('answers 409 when the ticket would have more than 5 attachments', async () => {
    const { owner, ticketId } = await setup();
    const three = () => [1, 2, 3].map((n) => ({ buffer: png(), name: `${n}.png` }));

    expect((await upload(ticketId, owner, three())).status).toBe(201);
    const over = await upload(ticketId, owner, three());

    expect(over.status).toBe(409);
    expect(over.body).toEqual({
      error: {
        code: 'ATTACHMENT_LIMIT',
        message: 'A ticket can have at most 5 attachments; this one has 3.',
      },
    });
    expect(await Attachment.countDocuments()).toBe(3);
    expect(await gridFsFiles().countDocuments()).toBe(3);

    const two = three().slice(0, 2);
    expect((await upload(ticketId, owner, two)).status).toBe(201);
    const full = await upload(ticketId, owner, [{ buffer: png(), name: '6.png' }]);
    expect(full.status).toBe(409);
    expect(full.body.error.message).toBe(
      'A ticket can have at most 5 attachments; this one has 5.',
    );
    expect(await Attachment.countDocuments()).toBe(5);
  });

  it('answers 400 without files, with another field name, or for a JSON body', async () => {
    const { owner, ticketId } = await setup();

    const none = await request(app)
      .post(base(ticketId))
      .set('Authorization', `Bearer ${owner.token}`)
      .field('note', 'no file');
    const wrongField = await upload(ticketId, owner, [{ buffer: png(), name: 'a.png' }], {
      field: 'file',
    });
    const json = await request(app)
      .post(base(ticketId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ files: ['a.png'] });

    expect(none.status).toBe(400);
    expect(none.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Choose at least one file (field "files").',
    });
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.message).toBe('Send the files in the form field "files".');
    expect(json.status).toBe(400);
    expect(json.body.error.code).toBe('VALIDATION_ERROR');
    await expectNothingStored();
  });

  it('answers 409 on a closed ticket', async () => {
    const { owner, ticket, ticketId } = await setup();
    await Ticket.updateOne({ _id: ticket._id }, { status: 'closed' });

    const response = await upload(ticketId, owner, [{ buffer: png(), name: 'a.png' }]);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('TICKET_CLOSED');
    await expectNothingStored();
  });

  it("answers 404 for another customer's ticket, an unknown or an invalid id", async () => {
    const { stranger, ticketId } = await setup();
    const file = [{ buffer: png(), name: 'a.png' }];

    const foreign = await upload(ticketId, stranger, file);
    const unknown = await upload(new mongoose.Types.ObjectId().toString(), stranger, file);
    const invalid = await upload('not-an-id', stranger, file);

    for (const response of [foreign, unknown, invalid]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(TICKET_NOT_FOUND);
    }
    await expectNothingStored();
  });

  it('answers 401 without a token', async () => {
    const { ticketId } = await setup();

    const response = await upload(ticketId, null, [{ buffer: png(), name: 'a.png' }]);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    await expectNothingStored();
  });

  it('sanitises the filename and never uses it for storage', async () => {
    const { owner, ticketId } = await setup();

    const response = await upload(ticketId, owner, [
      { buffer: png(), name: '../../etc/..hidden.png' },
      { buffer: pdf(), name: 'C:\\Users\\mara\\setup.exe' },
      { buffer: jpeg(), name: `${'x'.repeat(150)}.jpg` },
    ]);

    expect(response.status).toBe(201);
    const [first, second, third] = response.body.items;
    expect(first.name).toBe('hidden.png');
    expect(second.name).toBe('setup.exe.pdf');
    expect(third.name).toHaveLength(100);
    expect(third.name.endsWith('.jpg')).toBe(true);

    const files = await gridFsFiles().find().toArray();
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(file.filename).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('writes one audit entry per file with its name', async () => {
    const { owner, ticket, ticketId } = await setup();

    await upload(ticketId, owner, [
      { buffer: png(), name: 'one.png' },
      { buffer: pdf(), name: 'two.pdf' },
    ]);

    const entries = await AuditLog.find().sort({ _id: 1 }).lean();
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'ticket.attachment_added',
        actor: owner.user._id,
        entityType: 'ticket',
        entityId: ticket._id,
        metadata: { name: 'one.png' },
      }),
      expect.objectContaining({ action: 'ticket.attachment_added', metadata: { name: 'two.pdf' } }),
    ]);
  });

  it('writes no audit entry when the upload is rejected', async () => {
    const { owner, ticketId } = await setup();

    await upload(ticketId, owner, [{ buffer: Buffer.from('text'), name: 'a.png' }]);

    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('is rate limited by its own upload limiter', async () => {
    const { owner, ticketId } = await setup();
    const limited = createApp({
      env: { NODE_ENV: 'test' },
      rateLimit: { enabled: true, upload: { max: 1 } },
    });
    const file = () => [{ buffer: png(), name: 'a.png' }];

    expect((await upload(ticketId, owner, file(), { to: limited })).status).toBe(201);
    const second = await upload(ticketId, owner, file(), { to: limited });

    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    expect(second.body.error.message).toMatch(/^Too many uploads\./);
    expect(await Attachment.countDocuments()).toBe(1);
    // Listing is not an upload: it only counts toward the global limit.
    expect(
      (await request(limited).get(base(ticketId)).set('Authorization', `Bearer ${owner.token}`))
        .status,
    ).toBe(200);
  });
});

describe('no file is ever written to disk', () => {
  function recentFiles(root, since, skip, depth = 4) {
    const found = [];
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (skip.some((prefix) => full.startsWith(prefix))) continue;
      if (entry.isDirectory() && depth > 0) {
        found.push(...recentFiles(full, since, skip, depth - 1));
      } else if (entry.isFile()) {
        try {
          if (fs.statSync(full).mtimeMs >= since) found.push(full);
        } catch {
          // Removed while we looked: not ours.
        }
      }
    }
    return found;
  }

  it('keeps uploads in memory and GridFS only', async () => {
    const { owner, ticketId } = await setup();
    const marker = crypto.randomBytes(32);
    const writes = [
      jest.spyOn(fs, 'createWriteStream'),
      jest.spyOn(fs, 'writeFile'),
      jest.spyOn(fs, 'writeFileSync'),
      jest.spyOn(fs.promises, 'writeFile'),
    ];
    const since = Date.now() - 1000;

    const response = await upload(ticketId, owner, [{ buffer: png(marker), name: 'disk.png' }]);
    expect(response.status).toBe(201);
    const downloaded = await download(ticketId, response.body.items[0].id, owner);
    expect(downloaded.body.includes(marker)).toBe(true);

    for (const spy of writes) expect(spy).not.toHaveBeenCalled();

    // No new or changed file in the working directory or the temp directory holds the
    // upload. The in-memory MongoDB's own data directory is left out (it is the database).
    const skip = [
      mongoServer.instanceInfo.dbPath,
      path.join(process.cwd(), 'node_modules'),
      path.join(process.cwd(), 'coverage'),
      path.join(process.cwd(), '..', '.git'),
    ];
    const candidates = [
      ...recentFiles(process.cwd(), since, skip),
      ...recentFiles(os.tmpdir(), since, skip),
    ];
    for (const file of candidates) {
      let content;
      try {
        content = fs.readFileSync(file);
      } catch {
        continue;
      }
      expect({ file, holdsUpload: content.includes(marker) }).toEqual({
        file,
        holdsUpload: false,
      });
    }
  });
});

describe('GET /tickets/:ticketId/attachments', () => {
  it('lists id, name, type, size, createdAt and uploader, oldest first, no storage details', async () => {
    const { owner, agent, ticketId } = await setup();
    await upload(ticketId, owner, [{ buffer: png(), name: 'first.png' }]);
    await upload(ticketId, agent, [{ buffer: pdf(), name: 'second.pdf' }]);

    for (const actor of [owner, agent]) {
      const response = await list(ticketId, actor);

      expect(response.status).toBe(200);
      expect(response.body.items.map((item) => item.name)).toEqual(['first.png', 'second.pdf']);
      for (const item of response.body.items) {
        expect(Object.keys(item).sort()).toEqual(
          ['createdAt', 'id', 'name', 'size', 'type', 'uploadedBy'].sort(),
        );
      }
      expect(response.body.items[1].uploadedBy).toEqual({ id: agent.id, name: agent.name });
      expect(JSON.stringify(response.body)).not.toMatch(/gridFs|chunk|bucket|@example\.com/i);
    }
  });

  it("answers 404 for another customer's ticket and 401 without a token", async () => {
    const { owner, stranger, ticketId } = await setup();
    await upload(ticketId, owner, [{ buffer: png(), name: 'a.png' }]);

    const foreign = await list(ticketId, stranger);
    const anonymous = await list(ticketId, null);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(TICKET_NOT_FOUND);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual(UNAUTHENTICATED);
  });
});

describe('GET /tickets/:ticketId/attachments/:attachmentId', () => {
  it('sends the bytes as a download with safe headers, for the owner, agents and admins', async () => {
    const { owner, agent, admin, ticketId } = await setup();
    const buffer = pdf();
    const uploaded = await upload(ticketId, owner, [{ buffer, name: 'scan.pdf' }]);
    const { id } = uploaded.body.items[0];

    for (const actor of [owner, agent, admin]) {
      const response = await download(ticketId, id, actor);

      expect(response.status).toBe(200);
      expect(Buffer.compare(response.body, buffer)).toBe(0);
      expect(response.headers['content-type']).toBe('application/pdf');
      // RFC 6266: a plain token needs no quotes (names with spaces are quoted, below).
      expect(response.headers['content-disposition']).toBe('attachment; filename=scan.pdf');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['content-length']).toBe(String(buffer.length));
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    }
  });

  it('sends the detected type and an encoded filename for non-ASCII names', async () => {
    const { owner, ticketId } = await setup();
    const uploaded = await upload(ticketId, owner, [
      { buffer: jpeg(), name: 'Zoë "quote".png', contentType: 'image/png' },
    ]);

    const response = await download(ticketId, uploaded.body.items[0].id, owner);

    expect(response.headers['content-type']).toBe('image/jpeg');
    const disposition = response.headers['content-disposition'];
    expect(disposition).toMatch(/^attachment; /);
    expect(disposition).toContain("filename*=UTF-8''Zo%C3%AB%20_quote_.png.jpg");
    expect(disposition).not.toMatch(/inline/);

    const spaced = await upload(ticketId, owner, [{ buffer: png(), name: 'printer error.png' }]);
    const spacedResponse = await download(ticketId, spaced.body.items[0].id, owner);
    expect(spacedResponse.headers['content-disposition']).toBe(
      'attachment; filename="printer error.png"',
    );
  });

  it("answers 404 for another customer's ticket, an attachment of another ticket, or an unknown id", async () => {
    const { owner, stranger, agent, ticketId } = await setup();
    const uploaded = await upload(ticketId, owner, [{ buffer: png(), name: 'a.png' }]);
    const { id } = uploaded.body.items[0];
    const otherTicket = await Ticket.create({
      title: 'Other',
      description: 'Other',
      createdBy: stranger.user._id,
    });

    const foreign = await download(ticketId, id, stranger);
    const wrongTicket = await download(otherTicket.id, id, agent);
    const unknown = await download(ticketId, new mongoose.Types.ObjectId().toString(), owner);
    const invalid = await download(ticketId, 'nope', owner);

    expect(foreign.status).toBe(404);
    expect(JSON.parse(foreign.body.toString())).toEqual(TICKET_NOT_FOUND);
    for (const response of [wrongTicket, unknown, invalid]) {
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body.toString())).toEqual(ATTACHMENT_NOT_FOUND);
    }
  });

  it('answers 401 without a token', async () => {
    const { owner, ticketId } = await setup();
    const uploaded = await upload(ticketId, owner, [{ buffer: png(), name: 'a.png' }]);

    const response = await download(ticketId, uploaded.body.items[0].id, null);

    expect(response.status).toBe(401);
  });

  it('answers the uniform 500 when the stored bytes are missing', async () => {
    const { owner, ticketId } = await setup();
    const uploaded = await upload(ticketId, owner, [{ buffer: png(), name: 'a.png' }]);
    await gridFsFiles().deleteMany({});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await download(ticketId, uploaded.body.items[0].id, owner);

    expect(response.status).toBe(500);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(JSON.parse(response.body.toString())).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });
});

describe('DELETE /tickets/:ticketId/attachments/:attachmentId', () => {
  async function uploadAs(ticketId, actor) {
    const response = await upload(ticketId, actor, [{ buffer: png(), name: `${actor.name}.png` }]);
    return response.body.items[0].id;
  }

  it('lets the uploader delete their own file and removes the GridFS file', async () => {
    const { owner, agent, ticketId } = await setup();
    const ownerFile = await uploadAs(ticketId, owner);
    const agentFile = await uploadAs(ticketId, agent);

    const byOwner = await remove(ticketId, ownerFile, owner);
    const byAgent = await remove(ticketId, agentFile, agent);

    expect(byOwner.status).toBe(204);
    expect(byAgent.status).toBe(204);
    await expectNothingStored();
    expect(await gridFsFiles().countDocuments()).toBe(0);
    expect(await mongoose.connection.db.collection('attachments.chunks').countDocuments()).toBe(0);
    expect((await download(ticketId, ownerFile, owner)).status).toBe(404);
  });

  it("lets an admin delete anyone's file", async () => {
    const { owner, admin, ticketId } = await setup();
    const id = await uploadAs(ticketId, owner);

    expect((await remove(ticketId, id, admin)).status).toBe(204);
    await expectNothingStored();
  });

  it("refuses an agent deleting someone else's file and a customer deleting a staff file", async () => {
    const { owner, agent, otherAgent, ticketId } = await setup();
    const ownerFile = await uploadAs(ticketId, owner);
    const agentFile = await uploadAs(ticketId, agent);

    const agentOnCustomer = await remove(ticketId, ownerFile, agent);
    const agentOnAgent = await remove(ticketId, agentFile, otherAgent);
    const customerOnAgent = await remove(ticketId, agentFile, owner);

    for (const response of [agentOnCustomer, agentOnAgent, customerOnAgent]) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual(FORBIDDEN);
    }
    expect(await Attachment.countDocuments()).toBe(2);
    expect(await gridFsFiles().countDocuments()).toBe(2);
  });

  it("answers 404 for another customer's ticket and 401 without a token", async () => {
    const { owner, stranger, ticketId } = await setup();
    const id = await uploadAs(ticketId, owner);

    const foreign = await remove(ticketId, id, stranger);
    const anonymous = await remove(ticketId, id, null);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(TICKET_NOT_FOUND);
    expect(anonymous.status).toBe(401);
    expect(await Attachment.countDocuments()).toBe(1);
  });

  it('writes a ticket.attachment_removed audit entry with the name', async () => {
    const { owner, admin, ticket, ticketId } = await setup();
    const id = await uploadAs(ticketId, owner);

    await remove(ticketId, id, admin);

    const entry = await AuditLog.findOne({ action: 'ticket.attachment_removed' }).lean();
    expect(entry).toMatchObject({
      actor: admin.user._id,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: { name: `${owner.name}.png` },
    });
  });

  it('answers 404 the second time and writes one audit entry', async () => {
    const { owner, ticketId } = await setup();
    const id = await uploadAs(ticketId, owner);

    expect((await remove(ticketId, id, owner)).status).toBe(204);
    const again = await remove(ticketId, id, owner);

    expect(again.status).toBe(404);
    expect(again.body).toEqual(ATTACHMENT_NOT_FOUND);
    expect(await AuditLog.countDocuments({ action: 'ticket.attachment_removed' })).toBe(1);
  });
});
