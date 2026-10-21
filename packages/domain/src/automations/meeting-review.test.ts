import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { meetingReview } from './meeting-review.ts';
import type { CheckedProposal } from './proposal-schema.ts';

/** #226: what the owner should still see of a meeting is one proposal, never one per item. */

const MEETING = createVaultPath('Meetings/2026-10-14 Renewal review.md');
const IDENTITY = { provider: 'gemini', externalId: 'gemini-5c1d' };

const proposal = (fields: {
  kind?: CheckedProposal['kind'];
  title: string;
  block: string;
  properties?: Record<string, unknown>;
  note?: string;
}): CheckedProposal => ({
  kind: fields.kind ?? 'task',
  payload: {
    title: fields.title,
    folder: null,
    properties: fields.properties ?? { status: 'inbox' },
    body: '',
    linkFrom: null,
  },
  source: `[[2026-10-14 Renewal review#^${fields.block}]]`,
  cites: {
    note: fields.note === undefined ? MEETING : createVaultPath(fields.note),
    meeting: IDENTITY,
    block: fields.block,
  },
  confidence: 'medium',
  why: '',
  distinguishedBy: 'self',
  sharedAcrossRules: true,
});

const SEND = proposal({
  title: 'Send the renewal contract',
  block: 't0001',
  properties: { status: 'inbox', due: '2026-10-16' },
});
const WAIT = proposal({
  title: 'Flag the new cache',
  block: 't0002',
  properties: { status: 'waiting', waiting_on: '[[Tobias Fenn]]' },
});
const DECIDED = proposal({
  kind: 'decision',
  title: 'Renew for a year',
  block: 't0003',
  properties: {},
});
const CHASE = proposal({ kind: 'follow-up', title: 'Chase the signed copy', block: 't0004' });

describe('meetingReview', () => {
  it('is nothing when there is nothing to review', () => {
    expect(meetingReview([])).toBeNull();
  });

  it('is one task in the Inbox, linked to its meeting, listing every item with its turn', () => {
    const review = meetingReview([SEND, WAIT, DECIDED, CHASE])!;

    expect(review).toMatchObject({
      kind: 'task',
      confidence: 'medium',
      source: SEND.source,
      cites: SEND.cites,
      sharedAcrossRules: false,
      payload: {
        title: 'Review what 2026-10-14 Renewal review left for you',
        folder: null,
        properties: { status: 'inbox', meeting: '[[2026-10-14 Renewal review]]' },
        linkFrom: null,
      },
    });
    expect(review.payload.body.split('\n')).toEqual([
      'DFAI was not sure enough to make these tasks. Make a task of each that is yours, and delete the rest.',
      '',
      '- [ ] Send the renewal contract (due 2026-10-16) [[2026-10-14 Renewal review#^t0001]]',
      '- [ ] Waiting on [[Tobias Fenn]]: Flag the new cache [[2026-10-14 Renewal review#^t0002]]',
      '- [ ] Decided: Renew for a year [[2026-10-14 Renewal review#^t0003]]',
      '- [ ] Follow up: Chase the signed copy [[2026-10-14 Renewal review#^t0004]]',
    ]);
    expect(review.why).toBe(
      '4 items from 2026-10-14 Renewal review that may be yours: accept to keep them as one task to go through, or reject them all.',
    );
  });

  it('says one item as one', () => {
    expect(meetingReview([SEND])!.why).toMatch(/^1 item from/);
  });

  it('is known by its items: the same items make the same review, others another', () => {
    const once = meetingReview([SEND, WAIT])!.distinguishedBy;

    expect(
      meetingReview([proposal({ title: ' send the RENEWAL contract ', block: 't0001' }), WAIT])!
        .distinguishedBy,
    ).toBe(once);
    expect(meetingReview([SEND])!.distinguishedBy).not.toBe(once);
    expect(meetingReview([SEND, CHASE])!.distinguishedBy).not.toBe(once);
    expect(once).toMatch(/^review:/);
  });

  it('refuses items of two meetings: a review is one meeting’s', () => {
    expect(() =>
      meetingReview([SEND, proposal({ title: 'x', block: 't0001', note: 'Meetings/Other.md' })]),
    ).toThrow('A meeting review lists the items of one meeting.');
  });
});
