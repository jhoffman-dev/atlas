import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import type { PageOutcome, WorkspaceOutcome } from './import-notion-workspace.ts';
import { workspaceImported, workspaceReportLines } from './workspace-report.ts';

const placed = (path: string, notes: string[] = []) => ({
  database: 'Tasks Tracker',
  title: path,
  id: 'a1000000000000000000000000000001',
  path: createVaultPath(path),
  type: 'task',
  notes,
  imported: { fields: {}, body: 'nothing' },
});

const PAGES: PageOutcome[] = [
  {
    kind: 'create',
    ...placed('Tasks/A.md', ['Waiting with nobody in People: held in the Inbox']),
    written: true,
  },
  {
    kind: 'update',
    ...placed('Tasks/B.md'),
    written: true,
    filled: false,
    changed: ['priority', 'body'],
    kept: ['status'],
  },
  { kind: 'unchanged', ...placed('Tasks/C.md'), kept: [] },
  {
    kind: 'unchanged',
    ...placed('Tasks/D.md', ['status "Blocked" is not one this import maps: put in the Inbox']),
    kept: [],
  },
  { kind: 'refused', database: 'People', title: '', reason: 'no page in the export has its title' },
  {
    kind: 'deleted',
    database: 'Tasks Tracker',
    title: 'Ship it',
    id: 'a1000000000000000000000000000004',
  },
];

const outcome = (pages: PageOutcome[], more: Partial<WorkspaceOutcome> = {}): WorkspaceOutcome => ({
  dryRun: false,
  pages,
  skipped: [{ what: 'Teams', reason: 'left out by --only' }],
  otherFiles: 2,
  meetings: null,
  warnings: [],
  recordProblem: null,
  ...more,
});

const MEETING = { title: 'Platform weekly sync', date: 'October 6, 2026' };

describe('the workspace report', () => {
  it('gives a line to every page that changed, kept an edit, says something or was refused; then the totals', () => {
    expect(workspaceReportLines(outcome(PAGES))).toEqual([
      'created   Tasks/A.md',
      'note      Tasks/A.md: Waiting with nobody in People: held in the Inbox',
      'updated   Tasks/B.md: priority, body',
      "kept      Tasks/B.md: status changed in Atlas and in Notion since the last import; Atlas's kept",
      'note      Tasks/D.md: status "Blocked" is not one this import maps: put in the Inbox',
      'refused   People "Untitled": no page in the export has its title',
      'deleted   Tasks Tracker "Ship it": imported before and deleted in Atlas, so not made again (--recreate-deleted brings it back)',
      'skipped   Teams: left out by --only',
      "6 pages: 1 created, 1 updated, 2 unchanged, 1 refused, 1 with Atlas's edits kept, 1 deleted in Atlas, 1 skipped, 2 attachments not brought in",
    ]);
  });

  it('on a dry run, says nothing was written and what would be', () => {
    const lines = workspaceReportLines(
      outcome(
        [
          { kind: 'create', ...placed('Tasks/A.md'), written: false },
          {
            kind: 'update',
            ...placed('Tasks/B.md'),
            written: false,
            filled: false,
            changed: ['status'],
            kept: [],
          },
        ],
        {
          dryRun: true,
          meetings: [{ kind: 'would-write', row: MEETING, path: 'Inbox/Meetings/x.md' }],
        },
      ),
    );
    expect(lines).toEqual([
      'dry run: nothing was written',
      'would create Tasks/A.md',
      'would update Tasks/B.md: status',
      'skipped   Teams: left out by --only',
      'Meeting notes:',
      'would write Inbox/Meetings/x.md',
      '1 rows: 0 written, 1 would be written, 0 already in the vault, 0 without a Source ID, 0 left out, 0 held, 0 refused',
      "2 pages: 1 to create, 1 to update, 0 unchanged, 0 refused, 0 with Atlas's edits kept, 0 deleted in Atlas, 1 skipped, 2 attachments not brought in",
    ]);
  });
});

describe('a note no run recorded importing', () => {
  it('lists every property it filled in', () => {
    const filled: PageOutcome = {
      kind: 'update',
      ...placed('People/mara.md'),
      written: true,
      filled: true,
      changed: ['role', 'slack'],
      kept: ['email'],
    };
    expect(workspaceReportLines(outcome([filled])).slice(0, 2)).toEqual([
      'filled    People/mara.md: role, slack (no record of an earlier import, so only what it lacked)',
      "kept      People/mara.md: email changed in Atlas and in Notion since the last import; Atlas's kept",
    ]);
  });
});

describe('whether the run brought everything in', () => {
  it('is so with nothing refused, no edit kept over Notion, and every meeting in; a deletion is no failure', () => {
    expect(
      workspaceImported(outcome([PAGES[0], PAGES[2], PAGES[3], PAGES[5]] as PageOutcome[])),
    ).toBe(true);
  });

  it('is not so with a page refused, an edit kept, or a meeting held', () => {
    expect(workspaceImported(outcome([PAGES[4]] as PageOutcome[]))).toBe(false);
    expect(workspaceImported(outcome([PAGES[1]] as PageOutcome[]))).toBe(false);
    expect(
      workspaceImported(
        outcome([], {
          meetings: [
            { kind: 'held', row: MEETING, reason: 'gemini dates need --gemini-dates (issue #44)' },
          ],
        }),
      ),
    ).toBe(false);
  });
});
