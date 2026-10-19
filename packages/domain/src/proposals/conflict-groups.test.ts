import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  acceptableAtOnce,
  conflictGroups,
  proposalEntries,
  type ConflictGroup,
} from './conflict-groups.ts';
import { readProposal, type ProposalNote } from './proposal.ts';

/**
 * #307 (Q12): two proposals conflict when they share kind, source and target
 * slot but differ in value. Same value is a duplicate, shown once. A
 * different slot never conflicts. Nothing is persisted: groups are recomputed
 * from the open proposals each time.
 */

const STANDUP = 'Inbox/Meetings/2026-10-16 Platform Standup.md';

function proposal(name: string, properties: Record<string, unknown>): ProposalNote {
  const reading = readProposal({
    path: createVaultPath(`Inbox/Proposals/${name}.md`),
    properties: { type: 'proposal', state: 'open', ...properties },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const link = (
  name: string,
  to: string,
  {
    source = '[[2026-10-16 Platform Standup#^t0002]]',
    note = STANDUP,
    property = 'people',
    confidence = 'low' as string | null,
  } = {},
) =>
  proposal(name, {
    kind: 'link',
    source,
    confidence,
    payload: { note, property, link: to, digest: null },
  });

const person = (name: string, title: string, linkFrom: Record<string, unknown> | null) =>
  proposal(name, {
    kind: 'person',
    source: '[[2026-10-16 Platform Standup]]',
    confidence: 'medium',
    payload: { title, folder: 'People', properties: {}, link_from: linkFrom },
  });

const task = (name: string, title: string, confidence: string | null = 'high') =>
  proposal(name, {
    kind: 'task',
    source: '[[2026-10-16 Platform Standup#^t0003]]',
    confidence,
    payload: { title, properties: { status: 'next-action' } },
  });

const paths = (group: ConflictGroup) =>
  group.choices.map((choice) => choice.proposals.map((each) => each.path));

describe('conflictGroups', () => {
  const MARA = link('Mara 1', '[[Mara Quill]]');
  const MARA_LARKSPUR = link('Mara 2', '[[Mara Quill (Larkspur)]]');
  const MARA_GARDEN = link('Mara 3', '[[Mara Quill (Garden)]]');

  it('groups proposals of one kind, source and slot whose values differ into one choice', () => {
    const [group, ...more] = conflictGroups([MARA, MARA_LARKSPUR, MARA_GARDEN]);
    expect(more).toEqual([]);
    expect(group?.kind).toBe('link');
    expect(group?.slot).toEqual({ note: STANDUP, property: 'people' });
    expect(paths(group!)).toEqual([[MARA.path], [MARA_LARKSPUR.path], [MARA_GARDEN.path]]);
  });

  it('leaves a proposal on its own when nothing else is for its slot', () => {
    expect(conflictGroups([MARA])).toEqual([]);
    expect(conflictGroups([MARA, task('Send', 'Send the file')])).toEqual([]);
  });

  it('treats the same value twice as one duplicate, not a choice', () => {
    const again = link('Mara again', '[[Mara Quill]]');
    expect(conflictGroups([MARA, again])).toEqual([]);
    const [group] = conflictGroups([MARA, again, MARA_LARKSPUR]);
    expect(paths(group!)).toEqual([[MARA.path, again.path], [MARA_LARKSPUR.path]]);
  });

  it('never conflicts across slots: another property, or another note, is its own question', () => {
    const elsewhere = link('Mara 2', '[[Mara Quill (Larkspur)]]', { property: 'owner' });
    const otherNote = link('Mara 3', '[[Mara Quill (Garden)]]', {
      note: 'Inbox/Meetings/2026-10-17 Retro.md',
    });
    expect(conflictGroups([MARA, elsewhere, otherNote])).toEqual([]);
  });

  it('never conflicts across kinds, though the slot is the same', () => {
    const made = person('New Mara', 'Mara Quill (Garden)', { note: STANDUP, property: 'people' });
    expect(conflictGroups([MARA, made])).toEqual([]);
  });

  it('needs the same source: another block of the meeting is another mention', () => {
    const otherBlock = link('Mara 2', '[[Mara Quill (Larkspur)]]', {
      source: '[[2026-10-16 Platform Standup#^t0009]]',
    });
    const otherMeeting = link('Mara 3', '[[Mara Quill (Garden)]]', {
      source: '[[2026-10-17 Retro#^t0002]]',
    });
    expect(conflictGroups([MARA, otherBlock, otherMeeting])).toEqual([]);
  });

  it('takes a source naming the note alone as the same source as one naming its block', () => {
    const wholeNote = link('Mara 2', '[[Mara Quill (Larkspur)]]', {
      source: '[[2026-10-16 Platform Standup]]',
    });
    expect(conflictGroups([MARA, wholeNote])).toHaveLength(1);
  });

  it('reads the source link by its note, however it is cased or padded', () => {
    const cased = link('Mara 2', '[[Mara Quill (Larkspur)]]', {
      source: ' [[2026-10-16 platform standup#^t0002]] ',
    });
    expect(conflictGroups([MARA, cased])).toHaveLength(1);
  });

  it('groups proposals that cite nothing by their slot alone', () => {
    const uncited = [
      link('Mara 1', '[[Mara Quill]]', { source: null as unknown as string }),
      link('Mara 2', '[[Mara Quill (Larkspur)]]', { source: null as unknown as string }),
    ];
    expect(conflictGroups(uncited)).toHaveLength(1);
    expect(conflictGroups([uncited[0]!, MARA_LARKSPUR])).toEqual([]);
  });

  it('groups note proposals by the relation they would join, and by the title each makes', () => {
    const one = person('Mara A', 'Mara Quill', { note: STANDUP, property: 'people' });
    const two = person('Mara B', 'Mara Quill (Larkspur)', { note: STANDUP, property: 'people' });
    const same = person('Mara C', 'Mara Quill', { note: STANDUP, property: 'people' });
    const [group] = conflictGroups([one, two, same]);
    expect(paths(group!)).toEqual([[one.path, same.path], [two.path]]);
  });

  it('never groups a note proposal that joins no relation: it has no slot', () => {
    expect(conflictGroups([task('A', 'Send the file'), task('B', 'Send the Q4 file')])).toEqual([]);
    expect(conflictGroups([person('A', 'Mara', null), person('B', 'Mara Quill', null)])).toEqual(
      [],
    );
  });

  it('keeps the order the proposals came in, within a group and between groups', () => {
    const quote1 = link('Quote 1', '[[Atlas]]', { property: 'project' });
    const quote2 = link('Quote 2', '[[Garden]]', { property: 'project' });
    const groups = conflictGroups([quote1, MARA, quote2, MARA_LARKSPUR]);
    expect(groups.map((group) => group.slot.property)).toEqual(['project', 'people']);
  });

  it('is as sure as its least sure member, and unsure when none says', () => {
    const sure = link('Mara 2', '[[Mara Quill (Larkspur)]]', { confidence: 'high' });
    expect(conflictGroups([sure, MARA])[0]?.confidence).toBe('low');
    const medium = link('Mara 3', '[[Mara Quill (Garden)]]', { confidence: 'medium' });
    expect(conflictGroups([sure, medium])[0]?.confidence).toBe('medium');
    const silent = link('Mara 4', '[[Mara Quill (Garden)]]', { confidence: null });
    expect(conflictGroups([sure, silent])[0]?.confidence).toBe('high');
    const bothSilent = link('Mara 5', '[[Mara Quill]]', { confidence: null });
    expect(conflictGroups([silent, bothSilent])[0]?.confidence).toBeNull();
  });

  it('makes a fresh answer from the open proposals each time: nothing is kept', () => {
    const before = conflictGroups([MARA, MARA_LARKSPUR]);
    expect(conflictGroups([MARA])).toEqual([]);
    expect(before).toHaveLength(1);
  });
});

describe('proposalEntries', () => {
  const MARA = link('Mara 1', '[[Mara Quill]]');
  const MARA_LARKSPUR = link('Mara 2', '[[Mara Quill (Larkspur)]]');
  const SEND = task('Send', 'Send the file');

  it('lists each proposal where it came, a group standing where its first member was', () => {
    const entries = proposalEntries([SEND, MARA, task('Chase', 'Chase the quote'), MARA_LARKSPUR]);
    expect(entries.map((entry) => ('one' in entry ? entry.one.path : 'choice'))).toEqual([
      SEND.path,
      'choice',
      'Inbox/Proposals/Chase.md',
    ]);
  });

  it('lists a lone proposal as itself', () => {
    expect(proposalEntries([SEND])).toEqual([{ one: SEND }]);
  });
});

describe('acceptableAtOnce', () => {
  it('is every high-confidence proposal that needs no choice, in order', () => {
    const sure = task('Sure', 'Send the file', 'high');
    const unsure = task('Unsure', 'Chase the quote', 'low');
    const silent = task('Silent', 'Call the bank', null);
    const choice = [
      link('Mara 1', '[[Mara Quill]]', { confidence: 'high' }),
      link('Mara 2', '[[Mara Quill (Larkspur)]]', { confidence: 'high' }),
    ];
    const entries = proposalEntries([unsure, ...choice, sure, silent]);
    expect(acceptableAtOnce(entries)).toEqual([sure.path]);
  });
});
