import { describe, expect, it } from 'vitest';
import type { NoteChange } from '@atlas/domain';
import { REVIEW_SCOPE, scopeTouched } from '../reads/scoped-reads.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { readToday } from './read-today.ts';
import { todayScope } from './today-scope.ts';

const CLOCK = { today: () => '2026-10-13', now: () => Date.UTC(2026, 9, 13, 15) };

const note = (frontmatter: readonly string[]) => ['---', ...frontmatter, '---', ''].join('\n');
const task = (...frontmatter: string[]) => note(['type: task', ...frontmatter]);

const FILES = {
  'Projects/Atlas.md': note(['type: project', 'status: active']),
  'Notes/Garden plan.md': 'Where the beds go.\n',
  'Notes/Elsewhere.md': 'Nothing to do with it.\n',
  'Tasks/Sow the beans.md': task('status: next-action', 'project: "[[Garden plan]]"'),
  'Tasks/Weed the beds.md': task('status: in-progress', 'project: "[[Garden plan]]"'),
  'Tasks/Ship the page.md': task('status: next-action', 'project: "[[Atlas]]"'),
  'Tasks/Call the bank.md': task('status: next-action'),
  'Tasks/Done.md': task('status: archive', 'project: "[[Elsewhere]]"'),
};

const readTodayOf = (files: Record<string, string>) =>
  readToday({
    index: fakeIndexPort({ query: atlasQueryIndex({ markdown: fakeMarkdown(), files }) }),
    fs: fakeVaultFs(),
    markdown: fakeMarkdown(),
    clock: CLOCK,
  });

const edited = (path: string): NoteChange => ({
  kind: 'changed',
  path,
  type: null,
  digest: 'b',
  before: 'a',
});
const removed = (path: string) => ({ ...edited(path), kind: 'removed' }) as NoteChange;
const heard = (scope: ReturnType<typeof todayScope>, change: NoteChange) =>
  scopeTouched(scope, { changes: [change], facets: new Set() });

describe('todayScope (#392)', () => {
  it('reads Today again for the untyped note a listed task is filed under', async () => {
    const scope = todayScope(await readTodayOf(FILES));

    expect(heard(scope, edited('Notes/Garden plan.md'))).toBe(true);
    expect(heard(scope, removed('Notes/Garden plan.md'))).toBe(true);
    expect(heard(REVIEW_SCOPE, removed('Notes/Garden plan.md'))).toBe(false);
  });

  it('reads Today again for a note made with the name a task’s project links by, none yet', async () => {
    const scope = todayScope(
      await readTodayOf({
        'Tasks/Sow the beans.md': task('status: next-action', 'project: "[[Garden plan]]"'),
      }),
    );

    expect(heard(scope, { ...edited('Notes/Garden plan.md'), kind: 'added' } as NoteChange)).toBe(
      true,
    );
    expect(heard(scope, { ...edited('Notes/Garden.md'), kind: 'added' } as NoteChange)).toBe(false);
  });

  it('names each such note once, the review’s scope kept whole', async () => {
    const scope = todayScope(await readTodayOf(FILES));

    expect(scope).toEqual({
      ...REVIEW_SCOPE,
      notes: ['Notes/Garden plan.md', 'Projects/Atlas.md'],
      linkedNames: ['garden plan', 'atlas'],
    });
  });

  it('does not read Today again for an untyped note no listed task is filed under', async () => {
    // Only a finished task, which Today does not list, links Elsewhere.
    const scope = todayScope(await readTodayOf(FILES));

    expect(heard(scope, edited('Notes/Elsewhere.md'))).toBe(false);
  });

  it('is the review’s scope before Today has read, or when no task is filed under anything', async () => {
    expect(todayScope(null)).toBe(REVIEW_SCOPE);
    const unfiled = await readTodayOf({
      'Tasks/Call the bank.md': FILES['Tasks/Call the bank.md'],
    });
    expect(todayScope(unfiled)).toBe(REVIEW_SCOPE);
  });
});
