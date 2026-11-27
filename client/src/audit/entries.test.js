// Audit entry labels for the attachment actions (CD-18, docs/audit-log.md).
import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, ACTION_OPTIONS, describeDetails } from './entries.js';

describe('attachment audit entries', () => {
  it('labels the actions and offers them in the filter', () => {
    expect(ACTION_LABELS['ticket.attachment_added']).toBe('Attachment added');
    expect(ACTION_LABELS['ticket.attachment_removed']).toBe('Attachment removed');
    expect(ACTION_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining(['ticket.attachment_added', 'ticket.attachment_removed']),
    );
  });

  it('shows the file name as the details', () => {
    expect(
      describeDetails({ action: 'ticket.attachment_added', metadata: { name: 'scan.pdf' } }),
    ).toBe('File: scan.pdf');
    expect(describeDetails({ action: 'ticket.attachment_removed', metadata: {} })).toBe('File: ');
  });
});
