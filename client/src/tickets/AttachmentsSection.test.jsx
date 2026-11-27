// The attachments section of the ticket detail page (CD-18, docs/attachments.md), with the
// API module mocked: list, pre-check messages, upload, download and delete.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.js';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { storeSession } from '../test/helpers.jsx';
import AttachmentsSection from './AttachmentsSection.jsx';

vi.mock('../api/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getAttachments: vi.fn(),
  uploadAttachments: vi.fn(),
  downloadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

vi.mock('./attachments.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlob: vi.fn(),
}));

const api = await import('../api/index.js');
const { saveBlob } = await import('./attachments.js');

const MARA = { id: 'u1', name: 'Mara Jensen', role: 'customer' };
const LENA = { id: 'a1', name: 'Lena Berg', role: 'agent' };
const ANTON = { id: 'ad1', name: 'Anton Weber', role: 'admin' };
const TICKET = { id: 't1', status: 'open' };

// Local time, so the expected "dd.mm.yyyy, hh:mm" does not depend on the time zone.
const at = (hours, minutes) => new Date(2026, 11, 1, hours, minutes).toISOString();

function attachment(id, name, uploadedBy, fields = {}) {
  return {
    id,
    name,
    type: 'application/pdf',
    size: 120 * 1024,
    createdAt: at(9, 30),
    uploadedBy: { id: uploadedBy.id, name: uploadedBy.name },
    ...fields,
  };
}

const MARA_FILE = attachment('f1', 'scan.pdf', MARA);
const LENA_FILE = attachment('f2', 'error.png', LENA, { type: 'image/png', size: 900 });

function file(name, type, size = 10) {
  const result = new File(['x'], name, { type });
  Object.defineProperty(result, 'size', { value: size });
  return result;
}

function renderSection(user, { ticket = TICKET, items = [] } = {}) {
  storeSession('jwt-token', user);
  api.getAttachments.mockResolvedValue({ items });
  return render(
    <AuthProvider>
      <AttachmentsSection ticket={ticket} />
    </AuthProvider>,
  );
}

function section() {
  return screen.getByRole('region', { name: 'Attachments' });
}

function chooseFiles(...files) {
  fireEvent.change(screen.getByLabelText('Add files'), { target: { files } });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('list', () => {
  it('shows name, type, size, date and uploader, with download for everyone', async () => {
    renderSection(MARA, { items: [MARA_FILE, LENA_FILE] });

    const items = await within(section()).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('scan.pdf');
    expect(items[0].textContent).toContain('PDF · 120 KB · 01.12.2026, 09:30 · Mara Jensen');
    expect(items[1].textContent).toContain('PNG · 900 B');
    expect(screen.getByRole('button', { name: 'Download scan.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download error.png' })).toBeTruthy();
    expect(api.getAttachments).toHaveBeenCalledWith('t1', expect.anything());
  });

  it('offers delete only on own files, and on every file for an admin', async () => {
    renderSection(MARA, { items: [MARA_FILE, LENA_FILE] });
    await screen.findByText('scan.pdf');
    expect(screen.getByRole('button', { name: 'Delete scan.pdf' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete error.png' })).toBeNull();
    cleanup();

    renderSection(LENA, { items: [MARA_FILE, LENA_FILE] });
    await screen.findByText('scan.pdf');
    expect(screen.queryByRole('button', { name: 'Delete scan.pdf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete error.png' })).toBeTruthy();
    cleanup();

    renderSection(ANTON, { items: [MARA_FILE, LENA_FILE] });
    await screen.findByText('scan.pdf');
    expect(screen.getByRole('button', { name: 'Delete scan.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete error.png' })).toBeTruthy();
  });

  it('shows an empty state, the limits and a file input that accepts PNG, JPEG and PDF', async () => {
    renderSection(MARA);

    expect(await screen.findByText('No attachments yet.')).toBeTruthy();
    const input = screen.getByLabelText('Add files');
    expect(input.getAttribute('accept')).toBe(
      '.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf',
    );
    expect(input.multiple).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBe('attachment-hint');
    expect(screen.getByText(/PNG, JPEG or PDF, up to 2 MB each/)).toBeTruthy();
  });

  it('shows a load error with a retry', async () => {
    storeSession('jwt-token', MARA);
    api.getAttachments
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'X', message: 'Server down' }))
      .mockResolvedValueOnce({ items: [MARA_FILE] });
    render(
      <AuthProvider>
        <AttachmentsSection ticket={TICKET} />
      </AuthProvider>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain('Server down');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('scan.pdf')).toBeTruthy();
  });

  it('shows no form on a closed or full ticket, and says why', async () => {
    renderSection(MARA, { ticket: { ...TICKET, status: 'closed' } });
    expect(await screen.findByText('This ticket is closed; no files can be added.')).toBeTruthy();
    expect(screen.queryByLabelText('Add files')).toBeNull();
    cleanup();

    const five = [1, 2, 3, 4, 5].map((n) => attachment(`f${n}`, `${n}.pdf`, MARA));
    renderSection(MARA, { items: five });
    expect(await screen.findByText(/has 5 attachments, the maximum/)).toBeTruthy();
    expect(screen.queryByLabelText('Add files')).toBeNull();
  });
});

describe('pre-check before upload', () => {
  it('lists every problem, marks the input invalid and keeps Upload disabled', async () => {
    renderSection(MARA, { items: [MARA_FILE, LENA_FILE, attachment('f3', 'c.pdf', MARA)] });
    await screen.findByText('c.pdf');

    chooseFiles(
      file('notes.txt', 'text/plain'),
      file('big.png', 'image/png', 3 * 1024 * 1024),
      file('ok.pdf', 'application/pdf'),
    );

    const alert = screen.getByRole('alert');
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'This ticket can take 2 more files (at most 5 per ticket).',
      '"notes.txt" is not a PNG, JPEG or PDF file.',
      '"big.png" is 3 MB; the limit is 2 MB.',
    ]);
    const input = screen.getByLabelText('Add files');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('attachment-hint attachment-problems');
    expect(screen.getByRole('button', { name: 'Upload' }).disabled).toBe(true);
    expect(api.uploadAttachments).not.toHaveBeenCalled();
  });

  it('refuses more than 3 files at a time', async () => {
    renderSection(MARA);
    await screen.findByText('No attachments yet.');

    chooseFiles(...[1, 2, 3, 4].map((n) => file(`${n}.png`, 'image/png')));

    expect(screen.getByRole('alert').textContent).toContain(
      'Choose at most 3 files at a time (you chose 4).',
    );
    expect(screen.getByRole('button', { name: 'Upload' }).disabled).toBe(true);
  });

  it('asks for a file when Upload is pressed with none chosen', async () => {
    renderSection(MARA);
    await screen.findByText('No attachments yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(screen.getByRole('alert').textContent).toBe('Choose a file first.');
    expect(api.uploadAttachments).not.toHaveBeenCalled();
  });
});

describe('upload', () => {
  it('disables the form while uploading, then adds the files to the list', async () => {
    renderSection(MARA, { items: [MARA_FILE] });
    await screen.findByText('scan.pdf');
    let finish;
    api.uploadAttachments.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const chosen = [file('photo.jpg', 'image/jpeg'), file('report.pdf', 'application/pdf')];

    chooseFiles(...chosen);
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    const busy = await screen.findByRole('button', { name: 'Uploading...' });
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByLabelText('Add files').disabled).toBe(true);
    expect(api.uploadAttachments).toHaveBeenCalledWith('t1', chosen);

    finish({
      items: [
        attachment('n1', 'photo.jpg', MARA, { type: 'image/jpeg' }),
        attachment('n2', 'report.pdf', MARA),
      ],
    });

    expect((await screen.findByRole('status')).textContent).toBe('Uploaded 2 files.');
    expect(
      within(section())
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.attachment-name').textContent),
    ).toEqual(['scan.pdf', 'photo.jpg', 'report.pdf']);
    expect(screen.getByRole('button', { name: 'Upload' }).disabled).toBe(false);
    expect(screen.getByLabelText('Add files').value).toBe('');
  });

  it("shows the server's message from the uniform error shape", async () => {
    renderSection(MARA);
    await screen.findByText('No attachments yet.');
    api.uploadAttachments.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'UNSUPPORTED_FILE_TYPE',
        message: '"fake.png" is not a PNG, JPEG or PDF file. Only these types are allowed.',
      }),
    );

    chooseFiles(file('fake.png', 'image/png'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      '"fake.png" is not a PNG, JPEG or PDF file. Only these types are allowed.',
    );
    expect(screen.getByText('No attachments yet.')).toBeTruthy();
  });
});

describe('download', () => {
  it('downloads through the API client and saves the Blob under the stored name', async () => {
    renderSection(MARA, { items: [MARA_FILE] });
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    api.downloadAttachment.mockResolvedValue(blob);

    fireEvent.click(await screen.findByRole('button', { name: 'Download scan.pdf' }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'scan.pdf'));
    expect(api.downloadAttachment).toHaveBeenCalledWith('t1', 'f1');
  });

  it('shows the server message when the download fails', async () => {
    renderSection(MARA, { items: [MARA_FILE] });
    api.downloadAttachment.mockRejectedValue(
      new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Attachment not found' }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Download scan.pdf' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Attachment not found');
    expect(saveBlob).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('asks to confirm, deletes, and removes the file from the list', async () => {
    renderSection(MARA, { items: [MARA_FILE] });
    api.deleteAttachment.mockResolvedValue(null);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete scan.pdf' }));
    expect(screen.getByText('Delete this file?')).toBeTruthy();
    expect(api.deleteAttachment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete scan.pdf' }));

    expect((await screen.findByRole('status')).textContent).toBe('Deleted scan.pdf.');
    expect(api.deleteAttachment).toHaveBeenCalledWith('t1', 'f1');
    expect(screen.getByText('No attachments yet.')).toBeTruthy();
  });

  it('can be cancelled', async () => {
    renderSection(MARA, { items: [MARA_FILE] });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete scan.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Delete scan.pdf' })).toBeTruthy();
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it('keeps the file and shows the server message when deleting is refused', async () => {
    renderSection(MARA, { items: [MARA_FILE] });
    api.deleteAttachment.mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Delete scan.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete scan.pdf' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'You do not have permission to do this',
    );
    expect(screen.getByText('scan.pdf')).toBeTruthy();
  });
});
