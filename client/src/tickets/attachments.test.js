// Browser-side attachment checks (CD-18, docs/attachments.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPT, checkFiles, formatSize, saveBlob, typeLabel } from './attachments.js';

const MB = 1024 * 1024;

function file(name, type, size = 10) {
  const result = new File(['x'], name, { type });
  Object.defineProperty(result, 'size', { value: size });
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('checkFiles', () => {
  it('accepts PNG, JPEG and PDF files within the limits', () => {
    expect(
      checkFiles(
        [file('a.png', 'image/png'), file('b.JPG', 'image/jpeg'), file('c.pdf', 'application/pdf')],
        0,
      ),
    ).toEqual([]);
    expect(checkFiles([file('exact.png', 'image/png', 2 * MB)], 0)).toEqual([]);
    expect(checkFiles([file('no-type.pdf', '')], 0)).toEqual([]);
  });

  it('names files of another type, including a mismatched extension', () => {
    expect(
      checkFiles(
        [
          file('notes.txt', 'text/plain'),
          file('setup.exe', 'application/x-msdownload'),
          file('photo.gif', 'image/gif'),
          file('fake.png', 'application/pdf'),
          file('unknown', ''),
        ],
        0,
      ),
    ).toEqual([
      'Choose at most 3 files at a time (you chose 5).',
      '"notes.txt" is not a PNG, JPEG or PDF file.',
      '"setup.exe" is not a PNG, JPEG or PDF file.',
      '"photo.gif" is not a PNG, JPEG or PDF file.',
      '"fake.png" is not a PNG, JPEG or PDF file.',
      '"unknown" is not a PNG, JPEG or PDF file.',
    ]);
  });

  it('names files over 2 MB and empty files', () => {
    expect(
      checkFiles([file('big.pdf', 'application/pdf', 3.5 * MB), file('e.png', 'image/png', 0)], 0),
    ).toEqual(['"big.pdf" is 3.5 MB; the limit is 2 MB.', '"e.png" is empty.']);
  });

  it('enforces the per-ticket count with the room that is left', () => {
    const two = [file('a.png', 'image/png'), file('b.png', 'image/png')];
    expect(checkFiles(two, 3)).toEqual([]);
    expect(checkFiles(two, 4)).toEqual([
      'This ticket can take 1 more file (at most 5 per ticket).',
    ]);
    expect(checkFiles(two.slice(0, 1), 5)).toEqual([
      'This ticket already has 5 attachments, the maximum.',
    ]);
  });
});

describe('helpers', () => {
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(120 * 1024)).toBe('120 KB');
    expect(formatSize(1.5 * MB)).toBe('1.5 MB');
    expect(formatSize(2 * MB)).toBe('2 MB');
    expect(formatSize(undefined)).toBe('');
  });

  it('labels types and lists the accepted extensions and types', () => {
    expect(typeLabel('application/pdf')).toBe('PDF');
    expect(typeLabel('text/html')).toBe('File');
    expect(ACCEPT).toBe('.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf');
  });

  it('saves a Blob through a temporary download link and releases the URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:clinicdesk/1');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toBe('scan.pdf');
      expect(this.getAttribute('href')).toBe('blob:clinicdesk/1');
    });

    saveBlob(new Blob(['x']), 'scan.pdf');

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:clinicdesk/1');
    vi.unstubAllGlobals();
  });
});
