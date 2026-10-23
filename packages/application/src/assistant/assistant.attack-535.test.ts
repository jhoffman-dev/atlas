/**
 * Attack tests for PR #535 (assistant tools, P32-04): the three reads over
 * fixture vaults built to break them — many meetings, a renamed person, a
 * follow-up that waits, a path spelt decomposed. Left failing where they find
 * a bug; each names the invariant it holds the code to.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@dfai/domain';
import {
  ASSISTANT_FILES,
  assistantVault,
  daysAgo,
  jsonNote,
  KICKOFF,
  LARKSPUR,
  MARA,
} from '../testing/assistant-vault.ts';
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

describe('attack #535: meetings(about) over more meetings than are read', () => {
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

describe('attack #535: a person matched as they speak', () => {
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

describe('attack #535: open loops', () => {
  it('keeps who a waiting follow-up waits on', async () => {
    const files = {
      ...ASSISTANT_FILES,
      'Tasks/Chase the bank.md': jsonNote({
        type: 'task',
        status: 'waiting',
        waiting_on: '[[Tobias Fenn]]',
        tags: ['follow-up'],
        source: '[[Kickoff#^t0004]]',
      }),
    };
    const vault = assistantVault({ files });
    const loops = await readOpenLoops({ ...vault, path: mara });
    const chase = [...loops.followUps, ...loops.waitingFor, ...loops.openTasks].find(
      (task) => task.path === 'Tasks/Chase the bank.md',
    );
    expect(chase?.status).toBe('waiting');
    expect(chase?.waitingOn).toBe('[[Tobias Fenn]]');
  });
});

describe('attack #535: an entity path spelt decomposed', () => {
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

describe('attack #535: what meetings() reads from the vault', () => {
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
