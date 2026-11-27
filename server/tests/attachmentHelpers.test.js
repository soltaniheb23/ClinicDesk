// Pure helpers for attachments (CD-18, docs/attachments.md): type detection by magic bytes,
// the filename sanitiser and the limits object.
const { ALLOWED_TYPES, ATTACHMENT_LIMITS } = require('../src/attachments/limits');
const { detectFileType } = require('../src/attachments/detectType');
const { sanitizeFilename } = require('../src/attachments/filename');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');

describe('ATTACHMENT_LIMITS', () => {
  it('holds the agreed limits and the three allowed types', () => {
    expect(ATTACHMENT_LIMITS).toMatchObject({
      maxFileSize: 2 * 1024 * 1024,
      maxFilesPerRequest: 3,
      maxFilesPerTicket: 5,
      maxNameLength: 100,
    });
    expect(ALLOWED_TYPES).toEqual(['image/png', 'image/jpeg', 'application/pdf']);
    expect(Object.isFrozen(ATTACHMENT_LIMITS)).toBe(true);
  });
});

describe('detectFileType', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG (JFIF)', JPEG, 'image/jpeg'],
    ['JPEG (Exif)', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x12]), 'image/jpeg'],
    ['PDF', PDF, 'application/pdf'],
  ])('detects %s from its content', (_name, buffer, type) => {
    expect(detectFileType(buffer)).toBe(type);
  });

  it.each([
    ['a text file (named .png by the client)', Buffer.from('hello, this is not a PNG')],
    ['a Windows executable (renamed .pdf)', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])],
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['GIF', Buffer.from('GIF89a')],
    ['a ZIP (docx, xlsx)', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['"%PDF" without the dash', Buffer.from('%PDF')],
    ['a cut-off PNG signature', PNG.subarray(0, 7)],
    ['two JPEG bytes only', Buffer.from([0xff, 0xd8])],
    ['a PDF signature that is not at the start', Buffer.concat([Buffer.from(' '), PDF])],
    ['an empty file', Buffer.alloc(0)],
  ])('rejects %s', (_name, buffer) => {
    expect(detectFileType(buffer)).toBeNull();
  });

  it('returns null for anything that is not a Buffer', () => {
    expect(detectFileType('%PDF-1.7')).toBeNull();
    expect(detectFileType(undefined)).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('keeps a normal name', () => {
    expect(sanitizeFilename('printer error.png', 'image/png')).toBe('printer error.png');
    expect(sanitizeFilename('Scan 2026-11-27.PDF', 'application/pdf')).toBe('Scan 2026-11-27.PDF');
    expect(sanitizeFilename('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(sanitizeFilename('Überweisung für Zoë.pdf', 'application/pdf')).toBe(
      'Überweisung für Zoë.pdf',
    );
  });

  it.each([
    ['../../etc/passwd.png', 'passwd.png'],
    ['..\\..\\Windows\\win.ini.png', 'win.ini.png'],
    ['C:\\Users\\mara\\Desktop\\screen.png', 'screen.png'],
    ['/var/tmp/x.png', 'x.png'],
  ])('drops path separators and directories (%j)', (input, expected) => {
    expect(sanitizeFilename(input, 'image/png')).toBe(expected);
  });

  it('removes control and bidi characters and leading dots', () => {
    expect(sanitizeFilename('bad\u0000na\r\nme\u007f.png', 'image/png')).toBe('badname.png');
    expect(sanitizeFilename('invoice\u202egnp.exe.png', 'image/png')).toBe('invoicegnp.exe.png');
    expect(sanitizeFilename('.htaccess.png', 'image/png')).toBe('htaccess.png');
    expect(sanitizeFilename('...  .hidden.png', 'image/png')).toBe('hidden.png');
    expect(sanitizeFilename('a<b>c:"d"|e?f*.png', 'image/png')).toBe('a_b_c__d__e_f_.png');
    expect(sanitizeFilename('  many   spaces \t here.png ', 'image/png')).toBe(
      'many spaces here.png',
    );
  });

  it('adds the extension of the detected type when the name does not match it', () => {
    expect(sanitizeFilename('setup.exe', 'application/pdf')).toBe('setup.exe.pdf');
    expect(sanitizeFilename('page.html', 'image/png')).toBe('page.html.png');
    expect(sanitizeFilename('photo.png', 'image/jpeg')).toBe('photo.png.jpg');
    expect(sanitizeFilename('README', 'application/pdf')).toBe('README.pdf');
    expect(sanitizeFilename('trailing dot.', 'image/png')).toBe('trailing dot.png');
  });

  it('falls back to "attachment" when nothing is left', () => {
    expect(sanitizeFilename('', 'image/png')).toBe('attachment.png');
    expect(sanitizeFilename(undefined, 'application/pdf')).toBe('attachment.pdf');
    expect(sanitizeFilename('../', 'image/jpeg')).toBe('attachment.jpg');
    expect(sanitizeFilename('\u0000\u0001', 'image/png')).toBe('attachment.png');
    expect(sanitizeFilename('...', 'image/png')).toBe('attachment.png');
  });

  it('cuts long names to 100 characters and keeps the extension', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.pdf`, 'application/pdf');
    expect(name).toHaveLength(100);
    expect(name.endsWith('.pdf')).toBe(true);

    const emoji = sanitizeFilename(`${'😀'.repeat(150)}.png`, 'image/png');
    expect([...emoji]).toHaveLength(100);
    expect(emoji.endsWith('.png')).toBe(true);
  });
});
