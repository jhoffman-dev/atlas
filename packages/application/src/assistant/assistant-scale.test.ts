/**
 * The assistant's tools on a 5,000-note vault (P32-04): each answers from a
 * bounded number of index statements and reads only the notes it answers
 * with — never the vault — and does so fast. Times are generous ceilings
 * for a loaded CI machine; the counts are the real bar.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@dfai/domain';
import {
  ASSISTANT_FILES,
  assistantVault,
  daysAgo,
  jsonNote,
  MARA,
  MIGRATION,
} from '../testing/assistant-vault.ts';
import { indexPassageFinder } from './index-passage-finder.ts';
import { readBrief } from './read-brief.ts';
import { MEETINGS_READ_CAP, readMeetingQuotes } from './read-meeting-quotes.ts';
import { readOpenLoops } from './read-open-loops.ts';

const NOTES = 5000;
const MEETINGS = 600;
const TASKS = 1800;

const turns = (at: number) =>
  [
    '## Transcript',
    '',
    `**Mara Quill** [00:00:05] Point ${at} about the ledger. ^t0001`,
    '',
    `**Tobias Fenn** [00:00:30] ${at % 50 === 0 ? 'The bank file is late.' : 'Agreed.'} ^t0002`,
  ].join('\n');

/** The fixture vault, grown to 5,000 notes: Mara's meetings, the project's tasks, and notes that name neither. */
function bigVault(): Record<string, string> {
  const files: Record<string, string> = { ...ASSISTANT_FILES };
  for (let at = 0; at < MEETINGS; at += 1) {
    files[`Meetings/Sync ${at}.md`] = jsonNote(
      {
        type: 'meeting',
        date: daysAgo(at % 700),
        people: ['[[Mara Quill]]'],
        project: '[[Payroll Migration]]',
      },
      turns(at),
    );
  }
  for (let at = 0; at < TASKS; at += 1) {
    const status = ['inbox', 'next-action', 'waiting', 'archive'][at % 4];
    files[`Tasks/Task ${at}.md`] = jsonNote({
      type: 'task',
      status,
      project: at % 3 === 0 ? '[[Payroll Migration]]' : null,
      waiting_on: status === 'waiting' && at % 2 === 0 ? '[[Mara Quill]]' : null,
      ...(at % 10 === 0 && { tags: ['follow-up'], source: `[[Sync ${at % MEETINGS}#^t0002]]` }),
    });
  }
  for (let at = Object.keys(files).length; at < NOTES; at += 1) {
    files[`Notes/Note ${at}.md`] = jsonNote(
      { type: 'note' },
      `Unrelated words about the bank, ${at}.`,
    );
  }
  return files;
}

async function timed<Answer>(read: () => Promise<Answer>): Promise<{ answer: Answer; ms: number }> {
  const started = performance.now();
  const answer = await read();
  return { answer, ms: performance.now() - started };
}

describe('the assistant on a 5,000-note vault', () => {
  const files = bigVault();
  const vault = assistantVault({ files, modified: {} });
  const mara = createVaultPath(MARA);

  it('holds 5,000 notes', () => {
    expect(Object.keys(files)).toHaveLength(NOTES);
  });

  it('briefs a person from a bounded number of statements, reading one note', async () => {
    vault.read.length = 0;
    vault.asked.length = 0;
    const { answer, ms } = await timed(() => readBrief({ ...vault, path: mara, date: null }));
    console.log(
      `brief: ${ms.toFixed(0)} ms, ${vault.asked.length} statements, ${vault.read.length} reads`,
    );
    expect(answer.meetings.length).toBeGreaterThan(0);
    expect(answer.followUps.length).toBeGreaterThan(0);
    expect(vault.read).toEqual([MARA]);
    expect(vault.asked.length).toBeLessThanOrEqual(12);
    expect(ms).toBeLessThan(3_000);
  });

  it('lists a project’s open loops from a bounded number of statements, reading one note', async () => {
    vault.read.length = 0;
    vault.asked.length = 0;
    const { answer, ms } = await timed(() =>
      readOpenLoops({ ...vault, path: createVaultPath(MIGRATION) }),
    );
    console.log(
      `open loops: ${ms.toFixed(0)} ms, ${vault.asked.length} statements, ${vault.read.length} reads`,
    );
    expect(answer.openTasks.length).toBeGreaterThan(0);
    expect(answer.truncated).toBe(true);
    expect(vault.read).toEqual([MIGRATION]);
    expect(vault.asked.length).toBeLessThanOrEqual(6);
    expect(ms).toBeLessThan(3_000);
  });

  it('quotes what was said about something, reading only the meetings search found, never more than its cap', async () => {
    vault.read.length = 0;
    vault.asked.length = 0;
    const { answer, ms } = await timed(() =>
      readMeetingQuotes({
        ...vault,
        finder: indexPassageFinder(vault.reads.index),
        path: mara,
        asked: { since: null, about: 'bank file', limit: 10 },
      }),
    );
    console.log(`meetings(about): ${ms.toFixed(0)} ms, ${vault.read.length} reads`);
    expect(answer.meetings.length).toBeGreaterThan(0);
    // Mara's own turns hold "ledger", never "bank file": only her kickoff turns answer.
    expect(
      answer.meetings.flatMap((meeting) => meeting.quotes.map((q) => q.speaker)),
    ).not.toContain('Tobias Fenn');
    expect(vault.read.length).toBeLessThanOrEqual(MEETINGS_READ_CAP + 1);
    expect(ms).toBeLessThan(3_000);
  });

  it('lists a person’s meetings since a day, reading no more than the limit', async () => {
    vault.read.length = 0;
    const { answer, ms } = await timed(() =>
      readMeetingQuotes({
        ...vault,
        finder: indexPassageFinder(vault.reads.index),
        path: mara,
        asked: { since: daysAgo(60), about: null, limit: 20 },
      }),
    );
    console.log(`meetings(since): ${ms.toFixed(0)} ms, ${vault.read.length} reads`);
    expect(answer.meetings).toHaveLength(20);
    expect(answer.truncated).toBe(true);
    expect(vault.read).toHaveLength(21);
    expect(ms).toBeLessThan(3_000);
  });
});
