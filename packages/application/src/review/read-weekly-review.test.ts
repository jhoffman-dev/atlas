import { describe, expect, it } from 'vitest';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { readWeeklyReview } from './read-weekly-review.ts';

/** A vault with nothing proposed: no Inbox/Proposals folder to read. */
const NO_PROPOSALS = { fs: fakeVaultFs(), markdown: fakeMarkdown() };

/** P30-07: the weekly review read from a vault's index, on a fixed clock. */
const NOW = Date.UTC(2026, 9, 8, 12);
const DAY = 86_400_000;
const CLOCK = { today: () => '2026-10-08', now: () => NOW };

const note = (frontmatter: readonly string[]) => ['---', ...frontmatter, '---', ''].join('\n');

const FILES = {
  'Projects/Atlas.md': note(['type: project', 'status: active']),
  'Projects/Garden.md': note(['type: project', 'status: active']),
  'Projects/Paused.md': note(['type: project', 'status: paused']),
  'People/Mara Quill.md': note(['type: person']),
  'Tasks/Quote from Larkspur.md': note([
    'type: task',
    'status: waiting',
    'waiting_on: [[Mara Quill]]',
  ]),
  'Tasks/Ship the review.md': note([
    'type: task',
    'status: next-action',
    'project: "[[Atlas]]"',
    'due: 2026-10-05',
  ]),
  'Tasks/Learn the cello.md': note(['type: task', 'status: someday']),
  'Tasks/Done.md': note(['type: task', 'status: archive', 'due: 2026-01-01']),
  'Inbox/Call the bank.md': note(['type: task', 'status: inbox']),
  'Inbox/Idea.md': 'A thought.\n',
};

const MODIFIED = {
  'Tasks/Quote from Larkspur.md': NOW - 10 * DAY,
  'Tasks/Ship the review.md': NOW - DAY,
  'Tasks/Learn the cello.md': NOW - 45 * DAY,
  'Tasks/Done.md': NOW - 300 * DAY,
  'Inbox/Call the bank.md': NOW,
};

const titles = (items: readonly { title: string }[]) => items.map((item) => item.title);

describe('readWeeklyReview', () => {
  it('yields exactly the expected items per section, and counts the Inbox', async () => {
    const query = atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES, modified: MODIFIED });
    const review = await readWeeklyReview({
      index: fakeIndexPort({ query }),
      ...NO_PROPOSALS,
      clock: CLOCK,
    });

    expect(titles(review.staleWaiting)).toEqual(['Quote from Larkspur']);
    expect(review.staleWaiting[0]?.waitingOn).toBe('Mara Quill');
    expect(titles(review.projectsWithoutNextAction)).toEqual(['Garden']);
    expect(titles(review.overdue)).toEqual(['Ship the review']);
    expect(titles(review.untouchedSomeday)).toEqual(['Learn the cello']);
    expect(review.inbox).toEqual({ count: 2, toFile: 2, toAnswer: 0, more: false });
    expect(review.today).toBe('2026-10-08');
    expect(review.truncated).toBe(false);
  });

  it.each(['weekly review: tasks', 'weekly review: projects'])(
    'says when the index held rows back (%s)',
    async (mark) => {
      const query = atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES });
      const heldBack = fakeIndexPort({
        query: async (sql, parameters) => ({
          ...(await query(sql, parameters)),
          truncated: sql.includes(mark),
        }),
      });
      const review = await readWeeklyReview({ index: heldBack, ...NO_PROPOSALS, clock: CLOCK });
      expect(review.truncated).toBe(true);
      expect(review.inbox.more).toBe(false);
    },
  );

  it('passes on what the index could not answer', async () => {
    const failing = fakeIndexPort({
      query: () => Promise.reject(new Error('the index is closed')),
    });
    await expect(
      readWeeklyReview({ index: failing, ...NO_PROPOSALS, clock: CLOCK }),
    ).rejects.toThrow('the index is closed');
  });

  it('counts the proposals waiting for an answer in the Inbox, as the sidebar does', async () => {
    const query = atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES, modified: MODIFIED });
    const proposed = proposalVault({
      'Inbox/Proposals/Send the file.md': jsonLinesNote({
        type: 'proposal',
        kind: 'task',
        state: 'open',
        payload: { title: 'Send Mara the file' },
      }),
    });
    const review = await readWeeklyReview({
      index: fakeIndexPort({ query }),
      fs: proposed.ports.fs,
      markdown: proposed.ports.markdown,
      clock: CLOCK,
    });
    expect(review.inbox).toEqual({ count: 3, toFile: 2, toAnswer: 1, more: false });
  });
});
