/**
 * Regressions found attacking the assistant tools (#535, P32-04): the three
 * reads over fixture vaults built to break them — many meetings, a renamed
 * person, a follow-up that waits, a path spelt decomposed. Each names the
 * invariant it holds the code to.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath, parseObjectType } from '@dfai/domain';
import {
  ASSISTANT_FILES,
  ASSISTANT_TYPES,
  assistantVault,
  changedDaysAgo,
  daysAgo,
  jsonNote,
  KICKOFF,
  LARKSPUR,
  MARA,
  MIGRATION,
  TOBIAS,
} from '../testing/assistant-vault.ts';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { taskStatusWords } from './assistant-reads.ts';
import { indexPassageFinder } from './index-passage-finder.ts';
import { readMeetingQuotes } from './read-meeting-quotes.ts';
import { readOpenLoops } from './read-open-loops.ts';

const mara = createVaultPath(MARA);

/** `count` meetings Mara speaks in, the `at`th dated `at` days ago; `words(at)` is what she says. */
function withMeetings(count: number, words: (at: number) => string): Record<string, string> {
  const files: Record<string, string> = { ...ASSISTANT_FILES };
  for (let at = 1; at <= count; at += 1) {
    files[`Meetings/Ledger ${String(at).padStart(3, '0')}.md`] = jsonNote(
      { type: 'meeting', date: daysAgo(at), people: ['[[Mara Quill]]'] },
      ['## Transcript', '', `**Mara Quill** [00:00:05] ${words(at)} ^t0001`].join('\n'),
    );
  }
  return files;
}

function quotes(
  files: Record<string, string>,
  asked: Parameters<typeof readMeetingQuotes>[0]['asked'],
) {
  const vault = assistantVault({ files, modified: {} });
  return readMeetingQuotes({
    ...vault,
    finder: indexPassageFinder(vault.reads.index),
    path: mara,
    asked,
  });
}

describe('meetings(about) over more meetings than are read', () => {
  it('says truncated when more meetings hold `about` than the 50 it can list', async () => {
    const files = withMeetings(60, (at) => `Point ${at} about the ledger.`);
    const answer = await quotes(files, { since: null, about: 'ledger', limit: 50 });
    expect(answer.meetings).toHaveLength(50);
    // 60 meetings hold "ledger"; 10 are not listed, and nothing says so.
    expect(answer.truncated).toBe(true);
  });

  it('lists the newest meetings holding `about`, not the ones search ranks best', async () => {
    // The older half say "ledger" often in few words, so bm25 ranks them first.
    const files = withMeetings(120, (at) =>
      at > 60
        ? 'Ledger ledger ledger.'
        : `About the ledger, and then a long ramble about the weather, the trains, lunch and ${at}.`,
    );
    const answer = await quotes(files, { since: null, about: 'ledger', limit: 10 });
    expect(answer.meetings.map((meeting) => meeting.date)).toEqual(
      Array.from({ length: 10 }, (_, at) => daysAgo(at + 1)),
    );
  });
});

describe('a person matched as they speak', () => {
  it('matches a person’s turns by their note’s name when its `title:` says something else', async () => {
    const files = {
      ...ASSISTANT_FILES,
      [MARA]: jsonNote({ type: 'person', title: 'Mara Quill (Larkspur)', aliases: ['MQ'] }),
    };
    const answer = await quotes(files, { since: null, about: null, limit: 10 });
    // The kickoff transcript writes her as "Mara Quill", as her file is named.
    expect(answer.speakers).toContain('Mara Quill');
    const kickoff = answer.meetings.find((meeting) => meeting.path === KICKOFF);
    expect(kickoff?.quotes.map((quote) => quote.speaker)).toContain('Mara Quill');
  });
});

describe('open loops', () => {
  // The kickoff's `tasks` joins this to the kickoff; it names no person, so it is the owner's to chase.
  const chasing = (more: Record<string, unknown>) => ({
    ...ASSISTANT_FILES,
    'Tasks/Chase the bank.md': jsonNote({
      type: 'task',
      status: 'waiting',
      tags: ['follow-up'],
      source: '[[Kickoff#^t0004]]',
      ...more,
    }),
  });

  it('keeps who a waiting follow-up waits on, and for how long', async () => {
    const vault = assistantVault({
      files: chasing({ waiting_on: 'the bank' }),
      modified: { 'Tasks/Chase the bank.md': changedDaysAgo(6) },
    });
    const loops = await readOpenLoops({ ...vault, path: mara });
    const chase = loops.followUps.find((task) => task.path === 'Tasks/Chase the bank.md');
    expect(chase).toMatchObject({ status: 'waiting', waitingOn: 'the bank', waitingDays: 6 });
  });

  it('leaves out a follow-up a shared meeting reaches that waits on a different person', async () => {
    const vault = assistantVault({ files: chasing({ waiting_on: '[[Tobias Fenn]]' }) });
    const hers = await readOpenLoops({ ...vault, path: mara });
    expect(paths(hers)).not.toContain('Tasks/Chase the bank.md');
    // It is Tobias’s own to chase: he is named, so it is direct for him.
    const his = await readOpenLoops({ ...vault, path: createVaultPath(TOBIAS) });
    const chase = [...his.followUps, ...his.waitingFor].find(
      (task) => task.path === 'Tasks/Chase the bank.md',
    );
    expect(chase).toBeDefined();
  });

  it('keeps a follow-up that names the page itself, though it waits on a different person', async () => {
    const files = {
      ...chasing({ waiting_on: '[[Tobias Fenn]]' }),
      'Tasks/Chase the bank.md': jsonNote(
        { type: 'task', status: 'waiting', tags: ['follow-up'], waiting_on: '[[Tobias Fenn]]' },
        'Ask [[Mara Quill]] first.',
      ),
    };
    const loops = await readOpenLoops({ ...assistantVault({ files }), path: mara });
    const chase = [...loops.followUps, ...loops.waitingFor].find(
      (task) => task.path === 'Tasks/Chase the bank.md',
    );
    expect(chase).toBeDefined();
    if (chase !== undefined && 'via' in chase) expect(chase.via).toBe('direct');
  });

  it('cites a source whose block the note no longer holds as the note', async () => {
    const files = {
      ...ASSISTANT_FILES,
      'Tasks/Chase the bank.md': jsonNote({
        type: 'task',
        status: 'inbox',
        tags: ['follow-up'],
        source: '[[Kickoff#^t0099]]',
      }),
    };
    const loops = await readOpenLoops({ ...assistantVault({ files }), path: mara });
    expect(loops.followUps[0]?.source).toEqual({
      link: '[[Kickoff]]',
      kind: 'note',
      path: KICKOFF,
    });
  });
});

function paths(loops: Awaited<ReturnType<typeof readOpenLoops>>): string[] {
  return [...loops.openTasks, ...loops.waitingFor, ...loops.followUps].map((task) => task.path);
}

describe('an entity path spelt decomposed', () => {
  it('answers about a note whose name the caller sent in NFD, as macOS hands names out', async () => {
    const composed = 'People/Zoë Brandt.md';
    const files = { ...ASSISTANT_FILES, [composed]: jsonNote({ type: 'person' }) };
    const vault = assistantVault({ files });
    const answer = await readOpenLoops({
      ...vault,
      path: createVaultPath(composed.normalize('NFD')),
    });
    expect(answer.entity.path.normalize('NFC')).toBe(composed);
  });
});

describe('what meetings() reads from the vault', () => {
  it('reads no meeting file for a page that does not speak, asked nothing about', async () => {
    const vault = assistantVault();
    const answer = await readMeetingQuotes({
      ...vault,
      finder: indexPassageFinder(vault.reads.index),
      path: createVaultPath(LARKSPUR),
      asked: { since: null, about: null, limit: 10 },
    });
    expect(answer.meetings.length).toBeGreaterThan(0);
    expect(answer.meetings.every((meeting) => meeting.quotes.length === 0)).toBe(true);
    // ADR-0016: only the named note and the meeting files it quotes are read; it quotes none.
    expect(vault.read).toEqual([LARKSPUR]);
  });
});

describe('an index that fails part of the way', () => {
  /** The fixture vault whose index fails the statements `fails` recognises, with a path in its message. */
  function failing(fails: (sql: string) => boolean) {
    const vault = assistantVault();
    const query: typeof vault.reads.index.query = async (sql, parameters) => {
      if (fails(sql)) throw new Error('disk I/O error at /Users/someone/Vault/.atlas/index.db');
      return vault.reads.index.query(sql, parameters);
    };
    return { ...vault, reads: { ...vault.reads, index: { ...vault.reads.index, query } } };
  }

  it('answers open loops without the follow-ups, naming them as the problem', async () => {
    const vault = failing((sql) => sql.includes('WITH around'));
    const loops = await readOpenLoops({ ...vault, path: mara });
    expect(loops.followUps).toEqual([]);
    expect(loops.openTasks.length).toBeGreaterThan(0);
    expect(loops.problems).toEqual([
      { section: 'follow-ups', problem: expect.stringContaining('The index could not answer') },
    ]);
    expect(JSON.stringify(loops.problems)).not.toContain('/Users/');
  });

  it('answers open loops uncited when the sources cannot be read, and says so', async () => {
    const vault = failing((sql) => sql.includes('AS "source" FROM props'));
    const loops = await readOpenLoops({ ...vault, path: createVaultPath(MIGRATION) });
    expect(loops.waitingFor.map((task) => task.source)).toEqual([null, null]);
    expect(loops.problems.map((problem) => problem.section)).toEqual(['sources']);
  });

  it('answers meetings without the search that failed, naming it, and says more may match', async () => {
    const vault = assistantVault();
    const said = await readMeetingQuotes({
      ...vault,
      finder: {
        find: async () => {
          throw new Error('malformed MATCH expression at /Users/someone/Vault/.atlas/index.db');
        },
      },
      path: mara,
      asked: { since: null, about: 'bank', limit: 10 },
    });
    expect(said.meetings).toEqual([]);
    expect(said.truncated).toBe(true);
    expect(said.problems).toEqual([
      { section: 'search', problem: expect.stringContaining('The index could not answer') },
    ]);
    expect(JSON.stringify(said.problems)).not.toContain('/Users/');
  });
});

describe('the vault owner’s own turns', () => {
  const ask = (selfName: string | null) => {
    const vault = assistantVault();
    return readMeetingQuotes({
      ...vault,
      finder: indexPassageFinder(vault.reads.index),
      path: mara,
      asked: { since: null, about: null, limit: 10 },
      selfName,
    });
  };

  it('counts "You" among the turns of the person the profile names', async () => {
    const said = await ask('Mara Quill');
    const kickoff = said.meetings.find((meeting) => meeting.path === KICKOFF);
    expect(kickoff?.quotes.map((quote) => quote.speaker)).toEqual(['Mara Quill', 'MQ', 'You']);
  });

  it('counts it under the profile’s name in any common spelling, an alias too', async () => {
    const said = await ask('Quill, Mara');
    const kickoff = said.meetings.find((meeting) => meeting.path === KICKOFF);
    expect(kickoff?.quotes.map((quote) => quote.speaker)).toContain('You');
  });

  it('leaves "You" to the owner: another person’s page does not claim it', async () => {
    const said = await ask('Tobias Fenn');
    const kickoff = said.meetings.find((meeting) => meeting.path === KICKOFF);
    expect(kickoff?.quotes.map((quote) => quote.speaker)).not.toContain('You');
    const unknown = await ask(null);
    const again = unknown.meetings.find((meeting) => meeting.path === KICKOFF);
    expect(again?.quotes.map((quote) => quote.speaker)).not.toContain('You');
  });
});

describe('a task type whose status key the query language cannot name', () => {
  it('reads no status, as a linked page reads none, rather than naming it in a statement', () => {
    const odd = parseObjectType({
      name: 'task',
      properties: {
        'my status': { kind: 'select', options: ['todo', 'done'], done: 'done' },
      },
    });
    expect(taskStatusWords([odd])).toBeNull();
    expect(taskStatusWords(ASSISTANT_TYPES)).toEqual({ key: 'status', done: 'archive' });
  });
});

describe('a meeting file that cannot be read', () => {
  it('names a problem, never answering a meeting it could not read as one where nothing was said', async () => {
    const vault = assistantVault({ files: { ...ASSISTANT_FILES }, modified: {} });
    const inner = vault.reads.fs;
    const fs = fakeVaultFs({
      ...inner,
      readTextFile: async (path) => {
        if (path === KICKOFF) throw new VaultAccessError('permission denied');
        return inner.readTextFile(path);
      },
    });
    const reads = { ...vault.reads, fs };
    const answer = await readMeetingQuotes({
      reads,
      clock: vault.clock,
      finder: indexPassageFinder(reads.index),
      path: mara,
      asked: { since: null, about: null, limit: 10 },
    });
    const kickoff = answer.meetings.find((meeting) => meeting.path === KICKOFF);
    // The kickoff is listed with no quotes and nothing says it could not be read.
    expect(kickoff?.quotes).toEqual([]);
    expect(answer.problems.length > 0 || answer.truncated).toBe(true);
  });
});

describe('open loops when the page lists only some of its meetings', () => {
  it('says truncated when a follow-up reached only through an unlisted meeting is missing', async () => {
    // 205 meetings, more than a section holds (200): the oldest carries Mara's follow-up.
    const files: Record<string, string> = { ...ASSISTANT_FILES };
    for (let at = 1; at <= 205; at += 1) {
      files[`Meetings/Weekly ${String(at).padStart(3, '0')}.md`] = jsonNote({
        type: 'meeting',
        date: daysAgo(at + 400),
        people: ['[[Mara Quill]]'],
        ...(at === 205 ? { tasks: ['[[Chase the auditor]]'] } : {}),
      });
    }
    files['Tasks/Chase the auditor.md'] = jsonNote({
      type: 'task',
      status: 'inbox',
      tags: ['follow-up'],
    });
    const vault = assistantVault({ files, modified: {} });
    const answer = await readOpenLoops({ ...vault, path: mara });
    const found = answer.followUps.some((task) => task.path === 'Tasks/Chase the auditor.md');
    // Either the follow-up is found, or the answer says it may be missing.
    expect(found || answer.truncated).toBe(true);
  });
});
