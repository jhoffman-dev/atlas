import { describe, expect, it } from 'vitest';
import type { AcceptedProposal, ProposalArchived } from '@atlas/application';
import { answeredNotice, undoneNotice } from './answer-many.ts';

/** Which of a batch's notices stay until dismissed (review): only those saying something failed. */
const archived = (archiveProblem: string | null) => ({ archiveProblem }) as ProposalArchived;
const accepted = (headline: string) => ({ headline }) as AcceptedProposal;

describe('answeredNotice — whether it stays until read', () => {
  it('goes by itself when every one was answered, or when the cards say why the rest were not', () => {
    expect(answeredNotice('Rejected', { done: [archived(null)], failed: [] }).failed).toBe(false);
    const someNot = { done: [], failed: [{ item: 'a', reason: 'refused' }] };
    expect(answeredNotice('Rejected', someNot).failed).toBe(false);
  });

  it('stays when a rejected one was left in the Inbox, with nothing to undo', () => {
    const left = { done: [archived('The Archive is locked.')], failed: [] };
    expect(answeredNotice('Rejected', left).failed).toBe(true);
    expect(answeredNotice('Accepted', left)).toMatchObject({ undoable: true, failed: false });
  });
});

describe('undoneNotice — whether it stays until read', () => {
  it('stays when an undo of one or of several could not be done', () => {
    const one = [accepted('Call Mara')];
    expect(undoneNotice(one, { done: [], failed: [{ item: one[0]!, reason: 'x' }] }).failed).toBe(
      true,
    );
    expect(undoneNotice(one, { done: [one[0]], failed: [] }).failed).toBe(false);
    const two = [accepted('Call Mara'), accepted('Book the room')];
    expect(
      undoneNotice(two, { done: [two[0]], failed: [{ item: two[1]!, reason: 'x' }] }).failed,
    ).toBe(true);
    expect(undoneNotice(two, { done: two, failed: [] }).failed).toBe(false);
  });
});
