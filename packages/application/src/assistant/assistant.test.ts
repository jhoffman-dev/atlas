/**
 * The assistant's three reads (P32-04) over a fixture vault: every section's
 * query compiled and run against SQLite, search against FTS5, on a pinned
 * day. What is asserted is what each answer holds, how every item is cited,
 * and that only the notes answered with are read.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath, type Citation } from '@dfai/domain';
import {
  ASSISTANT_FILES,
  ASSISTANT_TODAY,
  assistantVault,
  CUTOVER,
  daysAgo,
  jsonNote,
  KICKOFF,
  LARKSPUR,
  MARA,
  MIGRATION,
  OLD_SYNC,
} from '../testing/assistant-vault.ts';
import { VaultAccessError, type VaultFsPort } from '../vault/ports.ts';
import { problemsOf } from './assistant-reads.ts';
import { indexPassageFinder } from './index-passage-finder.ts';
import type { PassageFinder } from './ports.ts';
import { readBrief } from './read-brief.ts';
import { AssistantEntityError } from './read-entity.ts';
import { readMeetingQuotes } from './read-meeting-quotes.ts';
import { readOpenLoops } from './read-open-loops.ts';

const at = createVaultPath;
const paths = (items: readonly { path: string }[]) => items.map((item) => item.path);
const block = (link: string, path: string): Citation => ({ link, kind: 'block', path });

/** Every citation an answer holds, wherever it sits. */
function citations(answer: unknown): Citation[] {
  if (Array.isArray(answer)) return answer.flatMap(citations);
  if (answer === null || typeof answer !== 'object') return [];
  const record = answer as Record<string, unknown>;
  const own = ['cite', 'source'].flatMap((key) => {
    const value = record[key];
    return value !== null && typeof value === 'object' && 'link' in value
      ? [value as Citation]
      : [];
  });
  return [...own, ...Object.values(record).flatMap(citations)];
}

/** Every item an answer holds that has a path: each must carry a citation. */
function items(answer: unknown): Record<string, unknown>[] {
  if (Array.isArray(answer)) return answer.flatMap(items);
  if (answer === null || typeof answer !== 'object') return [];
  const record = answer as Record<string, unknown>;
  const children = Object.entries(record)
    .filter(([key]) => key !== 'cite' && key !== 'source')
    .flatMap(([, value]) => items(value));
  return typeof record['path'] === 'string' ? [record, ...children] : children;
}

function expectEveryItemCited(answer: unknown): void {
  const listed = items(answer);
  expect(listed.length).toBeGreaterThan(0);
  for (const item of listed) {
    const cite = item['cite'] as Citation | undefined;
    expect(cite?.link, String(item['path'])).toMatch(/^\[\[[^\]]+\]\]$/);
    expect(cite?.path).toBe(item['path']);
  }
  for (const cite of citations(answer)) expect(cite.link).toMatch(/^\[\[[^\]]+\]\]$/);
}

describe('readOpenLoops', () => {
  it('lists a project’s open tasks, waiting-fors and the follow-ups from its meetings, each once and cited', async () => {
    const vault = assistantVault();
    const loops = await readOpenLoops({ ...vault, path: at(MIGRATION) });

    expect(loops.entity).toEqual({
      path: MIGRATION,
      title: 'Payroll Migration',
      type: 'project',
      cite: { link: '[[Payroll Migration]]', kind: 'note', path: MIGRATION },
    });
    expect(loops.date).toBe(ASSISTANT_TODAY);
    expect(paths(loops.openTasks)).toEqual(['Tasks/Draft the plan.md']);
    expect(loops.openTasks[0]).toMatchObject({
      status: 'next-action',
      due: daysAgo(2),
      overdue: true,
    });
    expect(paths(loops.waitingFor)).toEqual([
      'Tasks/Send the contract.md',
      'Tasks/Get the bank file.md',
    ]);
    expect(loops.waitingFor[0]).toMatchObject({
      waitingOn: '[[Tobias Fenn]]',
      waitingDays: 9,
      source: block('[[Kickoff#^t0002]]', KICKOFF),
    });
    // Made from the kickoff, filed under no project: found through the meeting.
    expect(paths(loops.followUps)).toEqual(['Tasks/Chase the bank.md']);
    expect(loops.followUps[0]?.source).toEqual(block('[[Kickoff#^t0004]]', KICKOFF));
    // It names no person, so it is the owner's to chase: it says it came through the kickoff.
    expect(loops.followUps[0]).toMatchObject({ via: 'meeting' });
    expect(loops.followUps[0]?.meeting?.cite.link).toBe('[[Kickoff]]');
    expect(loops.truncated).toBe(false);
    expect(loops.problems).toEqual([]);
    expectEveryItemCited(loops);
  });

  it('lists what a person is waited on for, and the follow-ups of the meetings they were in', async () => {
    const vault = assistantVault();
    const loops = await readOpenLoops({ ...vault, path: at(MARA) });
    expect(paths(loops.waitingFor)).toEqual(['Tasks/Get the bank file.md']);
    expect(paths(loops.openTasks)).toEqual(['Tasks/Draft the plan.md']);
    expect(paths(loops.followUps)).toEqual(['Tasks/Chase the bank.md']);
  });

  it('reads only the page’s own note from the vault', async () => {
    const vault = assistantVault();
    await readOpenLoops({ ...vault, path: at(MIGRATION) });
    expect(vault.read).toEqual([MIGRATION]);
  });

  it('refuses a note of a type it does not answer about, and one the vault does not hold', async () => {
    const vault = assistantVault();
    await expect(readOpenLoops({ ...vault, path: at(KICKOFF) })).rejects.toMatchObject({
      reason: 'not_a_page',
    });
    await expect(readOpenLoops({ ...vault, path: at('People/Nobody.md') })).rejects.toBeInstanceOf(
      AssistantEntityError,
    );
  });
});

describe('problemsOf', () => {
  it('says each section that could not be answered, and why', () => {
    const answered = { rows: [], truncated: false };
    expect(
      problemsOf([
        { id: 'tasks', ...answered, problem: null },
        { id: 'decisions', ...answered, problem: 'Unknown field "date"' },
      ]),
    ).toEqual([{ section: 'decisions', problem: 'Unknown field "date"' }]);
  });
});

describe('readBrief', () => {
  it('briefs a person: their last meeting, meetings to the day, open loops and recent mentions, all cited', async () => {
    const vault = assistantVault();
    const brief = await readBrief({ ...vault, path: at(MARA), date: null });

    expect(brief.date).toBe(ASSISTANT_TODAY);
    expect(brief.lastTouch?.path).toBe(CUTOVER);
    // The meeting dated after the day is not one they have had.
    expect(paths(brief.meetings)).toEqual([CUTOVER, KICKOFF, OLD_SYNC]);
    expect(brief.lastMeeting?.meeting.path).toBe(CUTOVER);
    expect(paths(brief.waitingFor)).toEqual(['Tasks/Get the bank file.md']);
    expect(paths(brief.followUps)).toEqual(['Tasks/Chase the bank.md']);
    expect(paths(brief.mentions)).toEqual(['Resources/Payroll runbook.md']);
    expect(brief.truncated).toBe(false);
    expectEveryItemCited(brief);
  });

  it('reads the day as of then: an earlier date has an earlier last meeting and what came of it', async () => {
    const vault = assistantVault();
    const brief = await readBrief({ ...vault, path: at(MARA), date: daysAgo(5) });
    expect(brief.lastTouch?.path).toBe(KICKOFF);
    expect(paths(brief.meetings)).toEqual([KICKOFF, OLD_SYNC]);
    expect(paths(brief.lastMeeting?.tasks ?? [])).toEqual([
      'Tasks/Chase the bank.md',
      'Tasks/Send the contract.md',
    ]);
    expect(paths(brief.lastMeeting?.decisions ?? [])).toEqual(['Decisions/Roll back first.md']);
    // The draft was due 2 days ago: not yet overdue 5 days ago.
    expect(brief.openTasks.find((task) => task.path === 'Tasks/Draft the plan.md')?.overdue).toBe(
      false,
    );
  });

  it('counts recent mentions and how long a waiting-for has waited from the day asked, not from today', async () => {
    const vault = assistantVault();
    // The runbook changed 2 days ago: not yet written 20 days ago, so not a mention then.
    const then = await readBrief({ ...vault, path: at(MARA), date: daysAgo(20) });
    expect(paths(then.mentions)).toEqual([]);
    const now = await readBrief({ ...vault, path: at(MARA), date: null });
    expect(paths(now.mentions)).toEqual(['Resources/Payroll runbook.md']);
    // "Send the contract" last changed 9 days ago: it had waited 7 days as of 2 days ago, and 9 now.
    const earlier = await readBrief({ ...vault, path: at(MIGRATION), date: daysAgo(2) });
    const later = await readBrief({ ...vault, path: at(MIGRATION), date: null });
    const waited = (brief: typeof later) =>
      brief.waitingFor.find((task) => task.path === 'Tasks/Send the contract.md')?.waitingDays;
    expect([waited(earlier), waited(later)]).toEqual([7, 9]);
  });

  it('briefs a project with its decisions, each citing the turn it came from', async () => {
    const vault = assistantVault();
    const brief = await readBrief({ ...vault, path: at(MIGRATION), date: null });
    expect(paths(brief.decisions)).toEqual(['Decisions/Roll back first.md']);
    expect(brief.decisions[0]?.source).toEqual(block('[[Kickoff#^t0003]]', KICKOFF));
    expect(paths(brief.meetings)).toEqual([CUTOVER, KICKOFF]);
    expectEveryItemCited(brief);
  });

  it('briefs a meeting: who was in it, its tasks split into open and waiting, its decisions', async () => {
    const vault = assistantVault();
    const brief = await readBrief({ ...vault, path: at(KICKOFF), date: null });
    expect(brief.related.map((note) => [note.path, note.relation])).toEqual([
      [MARA, 'person'],
      ['People/Tobias Fenn.md', 'person'],
      [LARKSPUR, 'company'],
    ]);
    expect(paths(brief.waitingFor)).toEqual(['Tasks/Send the contract.md']);
    expect(paths(brief.followUps)).toEqual(['Tasks/Chase the bank.md']);
    expect(brief.openTasks).toEqual([]);
    expect(paths(brief.decisions)).toEqual(['Decisions/Roll back first.md']);
    expect(brief.lastTouch).toBeNull();
    expect(brief.lastMeeting).toBeNull();
  });

  it('reads the page’s note and nothing else from the vault, in a bounded number of statements', async () => {
    const vault = assistantVault();
    await readBrief({ ...vault, path: at(MARA), date: null });
    expect(vault.read).toEqual([MARA]);
    // One statement per section of each page, plus sources and follow-ups.
    expect(vault.asked.length).toBeLessThanOrEqual(12);
  });

  it('refuses a page whose type the vault does not declare, rather than answer it has nothing', async () => {
    const vault = assistantVault({
      types: assistantVault().reads.types.filter((type) => type.name !== 'person'),
    });
    await expect(readBrief({ ...vault, path: at(MARA), date: null })).rejects.toMatchObject({
      reason: 'not_a_page',
      message: 'The vault has no person type to read its page by',
    });
  });

  it('refuses a task: it has no brief', async () => {
    const vault = assistantVault();
    await expect(
      readBrief({ ...vault, path: at('Tasks/Draft the plan.md'), date: null }),
    ).rejects.toMatchObject({
      reason: 'not_a_page',
      message: expect.stringContaining('this is a task note'),
    });
  });
});

describe('readMeetingQuotes', () => {
  const ask = (
    vault = assistantVault(),
    more: Partial<{ since: string; until: string; about: string; limit: number }> = {},
    path = MARA,
    finder?: PassageFinder,
  ) =>
    readMeetingQuotes({
      ...vault,
      finder: finder ?? indexPassageFinder(vault.reads.index),
      path: at(path),
      asked: {
        since: more.since ?? null,
        until: more.until ?? null,
        about: more.about ?? null,
        limit: more.limit ?? 10,
      },
    });

  it('quotes what a person said about something, by any of their names, each turn cited by its block', async () => {
    const vault = assistantVault();
    const said = await ask(vault, { about: 'bank file', since: daysAgo(30) });
    expect(said.speakers).toEqual(['Mara Quill', 'MQ']);
    // The meeting dated ahead holds the words too, but has not been held: not listed by default.
    expect(paths(said.meetings)).toEqual([KICKOFF]);
    expect(said.until).toBe(ASSISTANT_TODAY);
    expect(said.meetings[0]?.quotes).toEqual([
      {
        speaker: 'Mara Quill',
        time: '00:00:05',
        quote: 'The cut-over has to wait for the bank file.',
        cut: false,
        cite: block('[[Kickoff#^t0001]]', KICKOFF),
      },
      {
        speaker: 'MQ',
        time: '00:01:10',
        quote: 'And the bank file needs a rollback plan.',
        cut: false,
        cite: block('[[Kickoff#^t0003]]', KICKOFF),
      },
    ]);
    expect(vault.searched).toEqual(['"bank" "file"*']);
  });

  it('reads only the meetings search found, never the rest of the page’s meetings', async () => {
    const vault = assistantVault();
    await ask(vault, { about: 'rollback', since: daysAgo(30) });
    expect([...vault.read].sort()).toEqual([KICKOFF, CUTOVER, MARA].sort());
  });

  it('leaves out a meeting search found where none of the person’s turns holds the words', async () => {
    const vault = assistantVault();
    // Tobias said "Monday" in the cut-over review; Mara did not.
    const said = await ask(vault, { about: 'Monday' });
    expect(vault.read).toContain(CUTOVER);
    expect(said.meetings).toEqual([]);
  });

  it('cites a turn the file left without an id by the Transcript heading, writing nothing', async () => {
    const vault = assistantVault();
    const said = await ask(vault, { about: 'signed off' });
    expect(said.meetings[0]?.quotes[0]?.cite).toEqual({
      link: '[[Cut-over review#Transcript]]',
      kind: 'heading',
      path: CUTOVER,
    });
  });

  it('lists a person’s meetings since a day with all they said, newest first, without about', async () => {
    const said = await ask(assistantVault(), { since: daysAgo(30) });
    expect(paths(said.meetings)).toEqual([CUTOVER, KICKOFF]);
    expect(said.meetings.map((meeting) => meeting.matched)).toEqual([1, 2]);
  });

  it('lists a meeting still to come only when `until` reaches it', async () => {
    const files = {
      ...ASSISTANT_FILES,
      'Meetings/Next month.md': jsonNote(
        { type: 'meeting', date: daysAgo(-30), people: ['[[Mara Quill]]'] },
        '## Transcript\n\n**Mara Quill** The bank file will be late. ^t0001',
      ),
    };
    const byDefault = await ask(assistantVault({ files }), { since: daysAgo(30) });
    expect(paths(byDefault.meetings)).toEqual([CUTOVER, KICKOFF]);
    const reaching = await ask(assistantVault({ files }), {
      since: daysAgo(30),
      until: daysAgo(-10),
    });
    expect(paths(reaching.meetings)).toEqual(['Meetings/Later.md', CUTOVER, KICKOFF]);
    expect(reaching.until).toBe(daysAgo(-10));
    const only = await ask(assistantVault({ files }), { until: daysAgo(5), since: daysAgo(30) });
    expect(paths(only.meetings)).toEqual([KICKOFF]);
  });

  it('quotes everyone in a company’s meetings about something, and nobody without about', async () => {
    const about = await ask(assistantVault(), { about: 'cut-over', since: daysAgo(30) }, LARKSPUR);
    expect(about.speakers).toBeNull();
    expect(
      about.meetings.map((meeting) => [meeting.path, meeting.quotes.map((q) => q.speaker)]),
    ).toEqual([
      [CUTOVER, ['Tobias Fenn']],
      [KICKOFF, ['Mara Quill']],
    ]);
    const listed = await ask(assistantVault(), {}, LARKSPUR);
    expect(paths(listed.meetings)).toEqual([CUTOVER, KICKOFF]);
    expect(listed.meetings.every((meeting) => meeting.quotes.length === 0)).toBe(true);
  });

  it('keeps the blocks a semantic finder names, whatever their words', async () => {
    const semantic: PassageFinder = {
      find: async ({ within }) => {
        expect(within).toContain(KICKOFF);
        return { passages: [{ path: KICKOFF, blocks: ['t0003'] }], complete: true };
      },
    };
    const said = await ask(assistantVault(), { about: 'contingency' }, MARA, semantic);
    expect(said.meetings.map((meeting) => meeting.quotes.map((q) => q.cite.link))).toEqual([
      ['[[Kickoff#^t0003]]'],
    ]);
  });

  it('answers nothing for an about of punctuation alone, asking search nothing', async () => {
    const vault = assistantVault();
    const said = await ask(vault, { about: '?!' });
    expect(said.meetings).toEqual([]);
    expect(vault.searched).toEqual([]);
  });

  it('leaves out a meeting before the day, and an undated one, once since is given', async () => {
    const files = {
      ...ASSISTANT_FILES,
      'Meetings/Undated.md': jsonNote({ type: 'meeting', people: ['[[Mara Quill]]'] }),
    };
    const all = await ask(assistantVault({ files }));
    expect(paths(all.meetings)).toContain('Meetings/Undated.md');
    const since = await ask(assistantVault({ files }), { since: daysAgo(5) });
    expect(paths(since.meetings)).toEqual([CUTOVER]);
  });

  it('says there were more meetings than the limit', async () => {
    const said = await ask(assistantVault(), { limit: 1 });
    expect(said.meetings).toHaveLength(1);
    expect(said.truncated).toBe(true);
  });

  it('says nothing of a meeting gone from the vault since the index listed it', async () => {
    const vault = assistantVault();
    const readTextFile: VaultFsPort['readTextFile'] = async (path) => {
      if (path === KICKOFF) throw new VaultAccessError('gone');
      return vault.reads.fs.readTextFile(path);
    };
    const gone = { ...vault, reads: { ...vault.reads, fs: { ...vault.reads.fs, readTextFile } } };
    const said = await ask(gone, { since: daysAgo(30) });
    expect(said.meetings.find((meeting) => meeting.path === KICKOFF)?.quotes).toEqual([]);
  });

  it('refuses a meeting: it holds no meetings', async () => {
    await expect(ask(assistantVault(), {}, KICKOFF)).rejects.toMatchObject({
      reason: 'not_a_page',
    });
  });
});
