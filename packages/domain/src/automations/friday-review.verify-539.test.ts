/**
 * Verification of PR #539 after its fix round (#40, the Friday review draft):
 * the empty week, source ids in the written draft, and flattened names,
 * pushed past the cases the fix round's own tests cover. Fixed inputs only.
 */
import { describe, expect, it } from 'vitest';
import { wikiLinkSpans } from '../markdown/wikilink-spans.ts';
import { reviewDraftData, type ReviewDraftInput } from '../review/review-draft.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { keepCitedItems, nothingCitedProblem } from './cited-items.ts';
import { periodRecorded } from './output-period.ts';
import type { Schedule } from './schedule.ts';

const FRIDAYS: Schedule = { kind: 'weekly', day: 'friday', at: '15:00' };

const input = (fields: Partial<ReviewDraftInput> = {}): ReviewDraftInput => ({
  review: { staleWaiting: [], projectsWithoutNextAction: [], overdue: [], untouchedSomeday: [] },
  done: [],
  meetings: [],
  inbox: { toFile: 3, toAnswer: 0, more: false },
  truncated: false,
  today: '2026-10-23',
  now: Date.parse('2026-10-23T15:00:00Z'),
  ...fields,
});

describe('an empty week (coordinator decision on #539)', () => {
  it('lets a quiet week’s draft through though its one list item has nothing to cite', () => {
    // Handed nothing to cite, a model that writes "- Nothing this week." as a bullet must still get a draft.
    const cited = keepCitedItems({
      body: '## Wins\n\n- Nothing this week.\n\n3 notes wait in the Inbox.\n',
      sources: new Set(),
    });
    expect(nothingCitedProblem(cited)).toBeNull();
  });
});

describe('the written draft never holds a source id (#539, D9)', () => {
  const sources = new Set(['src:1']);
  const plain = new Map([['src:1', 'Pay A|B invoice']]);

  it('writes a source id in a sentence as its title, as it does in a list item', () => {
    const body = '- Paid it: [[src:1]]\n\nThe hardest one was [[src:1]].\n';
    const cited = keepCitedItems({ body, sources, plain });
    expect(cited.body).not.toContain('[[src:');
  });

  it('writes a source id in a heading as its title', () => {
    const body = '## [[src:1]]\n\n- Paid it: [[src:1]]\n';
    const cited = keepCitedItems({ body, sources, plain });
    expect(cited.body).not.toContain('[[src:');
  });
});

describe('a flattened name links nothing (#539, D10)', () => {
  it('leaves a title of three brackets with no link of its own in the data', () => {
    const given = reviewDraftData(
      input({
        done: [{ path: createVaultPath('Tasks/Odd.md'), title: '[[[Tasks/Secret plan.md]]]' }],
      }),
    );
    const line = given.data[0]!.text;
    expect(wikiLinkSpans(line).map(({ link }) => link.target)).toEqual(['Tasks/Odd.md']);
    // Its own link is the one double bracket on the line: the title's are broken.
    expect(line.split('[[')).toHaveLength(2);
  });
});

describe('periods of two rules that share a folder (#539, atlas_period)', () => {
  it('does not take a daily rule’s note in the same folder for the weekly rule’s week', () => {
    // A note stamped by another rule that writes to Reviews/ on Wednesday is not this week's review.
    const notes = [
      {
        path: createVaultPath('Reviews/Daily notes 2026-10-21.md'),
        period: { slot: '2026-10-21T07:00:00' },
      },
    ];
    expect(
      periodRecorded({
        entries: [],
        notes,
        period: { slot: '2026-10-23T15:00:00' },
        schedule: FRIDAYS,
        now: '2026-10-23T15:00:00',
      }),
    ).toBe(false);
  });
});
