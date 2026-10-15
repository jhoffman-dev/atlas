import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  isFiledByDefault,
  planProjectBackfill,
  projectBackfillLine,
  projectBackfillUndoLine,
} from './meeting-project-backfill.ts';
import type { MeetingOnRecord } from './meeting-series-queries.ts';

const LEDGER = { path: createVaultPath('Projects/Ledger.md'), title: 'Ledger' };

const meeting = (path: string, more: Partial<MeetingOnRecord> = {}): MeetingOnRecord => ({
  path: createVaultPath(path),
  title: 'Larkspur Standup',
  date: '2026-10-01',
  start: '09:30',
  provider: 'gemini',
  participants: ['email:tobias@larkspur.example'],
  project: null,
  filed: false,
  ...more,
});

const backfill = (meetings: readonly MeetingOnRecord[]) =>
  planProjectBackfill({ meetings, ownerKnown: true });

const filedOn = (date: string) =>
  meeting(`Meetings/${date} Standup.md`, { date, project: LEDGER, filed: true });

describe('planProjectBackfill', () => {
  it('lists every meeting with nothing in its project, newest first, with what its series says', () => {
    const rows = backfill([
      filedOn('2026-09-01'),
      filedOn('2026-09-02'),
      meeting('Meetings/2026-09-03 Standup.md', { date: '2026-09-03' }),
      meeting('Meetings/2026-09-05 Other.md', { date: '2026-09-05', title: 'Other' }),
    ]);
    expect(rows.map((row) => [row.meeting, row.suggestion?.confidence ?? null])).toEqual([
      ['Meetings/2026-09-05 Other.md', null],
      ['Meetings/2026-09-03 Standup.md', 'high'],
    ]);
    expect(rows[1]?.suggestion?.project).toBe(LEDGER.path);
  });

  it('leaves out a meeting filed under anything — even a closed project — and one in the Archive', () => {
    const rows = backfill([
      filedOn('2026-09-01'),
      meeting('Meetings/closed.md', { filed: true, project: null }),
      meeting('Archive/Meetings/old.md'),
    ]);
    expect(rows).toEqual([]);
  });

  it('judges each against the vault as it is: one unfiled meeting never votes for another', () => {
    const rows = backfill([
      meeting('Meetings/a.md', { date: '2026-09-01' }),
      meeting('Meetings/b.md', { date: '2026-09-02' }),
    ]);
    expect(rows.map((row) => row.suggestion)).toEqual([null, null]);
  });
});

describe('isFiledByDefault', () => {
  it('ticks only what is sure', () => {
    const [sure] = backfill([
      filedOn('2026-09-01'),
      filedOn('2026-09-02'),
      meeting('Meetings/x.md', { date: '2026-09-03' }),
    ]);
    const [unsure] = backfill([filedOn('2026-09-01'), meeting('Meetings/y.md')]);
    const [none] = backfill([meeting('Meetings/z.md')]);
    expect([sure, unsure, none].map((row) => row !== undefined && isFiledByDefault(row))).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe('the backfill’s words', () => {
  it('says what was filed and what was left', () => {
    expect(projectBackfillLine({ filed: 12, left: 0 })).toBe(
      'Filed 12 meetings under their projects.',
    );
    expect(projectBackfillLine({ filed: 1, left: 1 })).toBe(
      'Filed 1 meeting under its project. 1 meeting left as it was.',
    );
    expect(projectBackfillUndoLine({ restored: 3, left: 2 })).toBe(
      'Took the project off 3 meetings. 2 meetings changed since, so left as they are.',
    );
  });
});
