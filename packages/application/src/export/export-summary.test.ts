import { describe, expect, it } from 'vitest';
import { exportSummary } from './index.ts';

const saved = {
  kind: 'saved',
  format: 'markdown',
  where: '/Exports/Kickoff.md',
  notes: 1,
  attachments: 0,
  picturesLeftOut: 0,
} as const;

describe('exportSummary (#501)', () => {
  it('says what went where', () => {
    expect(exportSummary(saved)).toBe('Exported 1 note as Markdown to /Exports/Kickoff.md.');
    expect(exportSummary({ ...saved, format: 'standalone', attachments: 2 })).toBe(
      'Exported 1 note as standalone Markdown to /Exports/Kickoff.md, with 2 attachments.',
    );
    expect(exportSummary({ ...saved, format: 'pdf', notes: 3, where: '/Exports/Notes' })).toBe(
      'Exported 3 notes as PDFs to /Exports/Notes.',
    );
    expect(exportSummary({ ...saved, format: 'pdf' })).toBe(
      'Exported 1 note as a PDF to /Exports/Kickoff.md.',
    );
  });

  it('names the pictures that could not come along', () => {
    expect(exportSummary({ ...saved, attachments: 1, picturesLeftOut: 1 })).toBe(
      'Exported 1 note as Markdown to /Exports/Kickoff.md, with 1 attachment. 1 picture could not come along: not in the vault, unreadable or too large.',
    );
  });
});
