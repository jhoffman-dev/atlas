/**
 * Verification attacks on #535 after its fix round (head 89fc092e): the
 * assistant reads over fixture vaults built to break the fixes. Each names
 * the invariant it holds the code to.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@dfai/domain';
import {
  ASSISTANT_FILES,
  assistantVault,
  daysAgo,
  jsonNote,
  KICKOFF,
  MARA,
} from '../testing/assistant-vault.ts';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { indexPassageFinder } from './index-passage-finder.ts';
import { readMeetingQuotes } from './read-meeting-quotes.ts';
import { readOpenLoops } from './read-open-loops.ts';

const mara = createVaultPath(MARA);

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
