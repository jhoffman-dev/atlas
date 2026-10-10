import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { readCsv } from './notion-csv.ts';
import { readNotionPage } from './notion-page.ts';
import { DEFAULT_TASK_STATUSES } from './task-status.ts';
import { planWorkspace, type PlanInput } from './workspace-plan.ts';
import type { ExportDatabase } from './workspace-export.ts';

/* The plan alone, over hand-made input: the cases a real run only reaches by a race or a broken export. */

const ID = 'c3000000000000000000000000000001';

const people = (file: string, id: string | null): ExportDatabase => ({
  name: 'People',
  kind: 'people',
  csvPath: '/export/People.csv',
  csvFile: 'People.csv',
  csv: readCsv('Name,Role\nMara Quill,Head of Payroll\n'),
  pages: [{ file, id, page: readNotionPage('# Mara Quill\n\nRole: Head of Payroll\n') }],
});

const input = (
  database: ExportDatabase,
  texts: Map<VaultPath, string | null>,
  byNotionId = new Map<string, VaultPath[]>(),
): PlanInput => ({
  databases: [database],
  selected: new Set(['people']),
  vault: { paths: [...texts.keys()], byNotionId },
  texts,
  record: new Map(),
  statuses: DEFAULT_TASK_STATUSES,
  today: '2026-10-10',
  timeZone: 'America/Los_Angeles',
  recreateDeleted: false,
  meetingPaths: new Map(),
  meetingIds: new Set(),
});

describe('the plan', () => {
  it('refuses a page whose file name carries no Notion id: a later run could not find its note', () => {
    const plan = planWorkspace(input(people('People/Mara Quill.md', null), new Map()));
    expect(plan.pages).toEqual([
      {
        kind: 'refused',
        database: 'People',
        title: 'Mara Quill',
        reason: 'its page People/Mara Quill.md has no Notion id in its name',
      },
    ]);
  });

  it('never rewrites a note whose properties no longer read', () => {
    const path = createVaultPath('mara.md');
    const plan = planWorkspace(
      input(
        people(`People/Mara Quill ${ID}.md`, ID),
        new Map([[path, `---\nnotion_id: ${ID}\nrole: [unclosed\n---\n`]]),
        new Map([[ID, [path]]]),
      ),
    );
    expect(plan.pages).toEqual([
      expect.objectContaining({
        kind: 'refused',
        reason: expect.stringMatching(/^mara\.md's properties cannot be read \(.+\): not changed$/),
      }),
    ]);
  });

  it('names a new note so links can reach it: no link syntax in its name', () => {
    const database = {
      ...people(`People/x ${ID}.md`, ID),
      csv: readCsv('Name\nQ3 #1 [draft] | v2\n'),
      pages: [
        { file: `People/x ${ID}.md`, id: ID, page: readNotionPage('# Q3 #1 [draft] | v2\n') },
      ],
    };
    const plan = planWorkspace(input(database, new Map()));
    expect(plan.pages).toEqual([
      expect.objectContaining({ kind: 'create', path: 'People/Q3 1 draft v2.md' }),
    ]);
  });
});
