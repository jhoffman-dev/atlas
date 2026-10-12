import { describe, expect, it } from 'vitest';
import type { TodaySectionId } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { readToday, type TodayReport } from './read-today.ts';

/** A vault with nothing proposed: no Inbox/Proposals folder to read. */
const NO_PROPOSALS = { fs: fakeVaultFs(), markdown: fakeMarkdown() };

/** #111: the Today page read from a vault's index, on a fixed clock. */
const NOW = Date.UTC(2026, 9, 13, 15);
const DAY = 86_400_000;
const CLOCK = { today: () => '2026-10-13', now: () => NOW };

const note = (frontmatter: readonly string[]) => ['---', ...frontmatter, '---', ''].join('\n');
const task = (...frontmatter: string[]) => note(['type: task', ...frontmatter]);

const FILES = {
  'Projects/Atlas.md': note(['type: project', 'status: active']),
  'Projects/Garden.md': note(['type: project', 'status: active']),
  'Projects/Shed.md': note(['type: project', 'status: active']),
  'People/Mara Quill.md': note(['type: person']),
  'Tasks/Renew the licence.md': task('status: backlog', 'due: 2026-10-10'),
  'Tasks/Send the figures.md': task('status: next-action', 'due: 2026-10-13'),
  'Tasks/Book the venue.md': task('status: someday', 'defer: 2026-10-13'),
  'Tasks/Draft the plan.md': task('status: in-progress', 'project: "[[Atlas]]"'),
  'Tasks/Ship the page.md': task('status: next-action', 'project: "[[Atlas]]"', 'contexts: desk'),
  'Tasks/Sow the beans.md': task('status: next-action', 'project: "[[Garden]]"'),
  'Tasks/Call the bank.md': task('status: next-action'),
  'Tasks/Not yet.md': task('status: next-action', 'defer: 2026-10-14'),
  'Tasks/Quote from Larkspur.md': task('status: waiting', 'waiting_on: [[Mara Quill]]'),
  'Tasks/Done.md': task('status: archive', 'due: 2026-10-13'),
  'Inbox/Idea.md': 'A thought.\n',
};

const MODIFIED = { 'Tasks/Quote from Larkspur.md': NOW - 4 * DAY - 1000 };

const read = (clock = CLOCK) =>
  readToday({
    index: fakeIndexPort({
      query: atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES, modified: MODIFIED }),
    }),
    ...NO_PROPOSALS,
    clock,
  });

const sectionOf = (report: TodayReport, id: TodaySectionId) => {
  const found = report.sections.find((section) => section.id === id);
  if (found === undefined) throw new Error(`no section ${id}`);
  return found;
};
const titles = (report: TodayReport, id: TodaySectionId) =>
  sectionOf(report, id).groups.flatMap((group) => group.tasks.map((item) => item.title));

describe('readToday', () => {
  it('puts each of the vault’s tasks in its section, on the clock’s day', async () => {
    const report = await read();

    expect(report.today).toBe('2026-10-13');
    expect(titles(report, 'overdue')).toEqual(['Renew the licence']);
    expect(titles(report, 'dueToday')).toEqual(['Send the figures']);
    expect(titles(report, 'backToday')).toEqual(['Book the venue']);
    expect(titles(report, 'inProgress')).toEqual(['Draft the plan']);
    expect(titles(report, 'waiting')).toEqual(['Quote from Larkspur']);
    expect(report.sections.map((section) => section.count)).toEqual([1, 1, 1, 1, 3, 1]);
    expect(report.truncated).toBe(false);
  });

  it('groups next actions under their projects’ titles, and carries contexts', async () => {
    const next = sectionOf(await read(), 'nextActions');
    expect(
      next.groups.map((group) => [group.label, group.tasks.map((item) => item.title)]),
    ).toEqual([
      ['Atlas', ['Ship the page']],
      ['Garden', ['Sow the beans']],
      [null, ['Call the bank']],
    ]);
    expect(next.groups[0]?.project).toBe('Projects/Atlas.md');
    expect(next.groups[0]?.tasks[0]?.contexts).toEqual(['desk']);
  });

  it('says who a task waits on, and for how many days by its file’s last change', async () => {
    const [group] = sectionOf(await read(), 'waiting').groups;
    expect(group?.label).toBe('Mara Quill');
    expect(group?.tasks[0]?.waitingDays).toBe(4);
  });

  it('counts the Inbox as the sidebar does, and the stalled projects as the review does', async () => {
    const proposed = proposalVault({
      'Inbox/Proposals/Send the file.md': jsonLinesNote({
        type: 'proposal',
        kind: 'task',
        state: 'open',
        payload: { title: 'Send Mara the file' },
      }),
    });
    const report = await readToday({
      index: fakeIndexPort({
        query: atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES, modified: MODIFIED }),
      }),
      fs: proposed.ports.fs,
      markdown: proposed.ports.markdown,
      clock: CLOCK,
    });
    expect(report.inbox).toEqual({ count: 2, toFile: 1, toAnswer: 1, more: false });
    // Atlas and Garden have a next action or work under way; Shed has neither.
    expect(report.stalledProjects).toBe(1);
  });

  it('turns over with the clock: tomorrow the deferred task is back and today’s is late', async () => {
    const tomorrow = { today: () => '2026-10-14', now: () => NOW + DAY };
    const report = await read(tomorrow);
    expect(titles(report, 'overdue')).toEqual(['Renew the licence', 'Send the figures']);
    expect(titles(report, 'backToday')).toEqual(['Not yet']);
    expect(titles(report, 'dueToday')).toEqual([]);
  });

  it('reads every task in one statement, whatever the sections', async () => {
    const statements: string[] = [];
    const query = atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES });
    await readToday({
      index: fakeIndexPort({
        query: (sql, parameters) => {
          statements.push(sql);
          return query(sql, parameters);
        },
      }),
      ...NO_PROPOSALS,
      clock: CLOCK,
    });
    expect(statements.filter((sql) => sql.includes('weekly review: tasks'))).toHaveLength(1);
  });

  it('says when the index held tasks back', async () => {
    const query = atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES });
    const heldBack = fakeIndexPort({
      query: async (sql, parameters) => ({
        ...(await query(sql, parameters)),
        truncated: sql.includes('weekly review: tasks'),
      }),
    });
    expect((await readToday({ index: heldBack, ...NO_PROPOSALS, clock: CLOCK })).truncated).toBe(
      true,
    );
  });

  it('passes on what the index could not answer', async () => {
    const failing = fakeIndexPort({
      query: () => Promise.reject(new Error('the index is closed')),
    });
    await expect(readToday({ index: failing, ...NO_PROPOSALS, clock: CLOCK })).rejects.toThrow(
      'the index is closed',
    );
  });
});
