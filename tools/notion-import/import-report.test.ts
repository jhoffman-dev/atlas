import { describe, expect, it } from 'vitest';
import type { RowOutcome } from './import-notion-meetings.ts';
import { allImported, reportLines } from './import-report.ts';

const row = { title: 'Platform weekly sync', date: 'October 6, 2026 10:00 AM' };

const OUTCOMES: RowOutcome[] = [
  { kind: 'written', row, path: 'Inbox/Meetings/2026-10-06 Platform weekly sync.md' },
  { kind: 'in-vault', row, path: 'Meetings/Platform weekly sync.md' },
  { kind: 'no-source-id', row: { title: '', date: '' } },
  { kind: 'refused', row, reason: 'start: the meeting has no start time' },
];

describe('the import report', () => {
  it('gives every row a line saying what became of it, then the totals', () => {
    expect(reportLines(OUTCOMES)).toEqual([
      'wrote     Inbox/Meetings/2026-10-06 Platform weekly sync.md',
      'in vault  Meetings/Platform weekly sync.md, "Platform weekly sync" (October 6, 2026 10:00 AM)',
      'no id     "Untitled" (no date): no Source ID, so not imported',
      'refused   "Platform weekly sync" (October 6, 2026 10:00 AM): start: the meeting has no start time',
      '4 rows: 1 written, 1 already in the vault, 1 without a Source ID, 1 refused',
    ]);
  });

  it('counts the run as complete only when no row was refused', () => {
    expect(allImported(OUTCOMES)).toBe(false);
    expect(allImported(OUTCOMES.slice(0, 3))).toBe(true);
  });
});
