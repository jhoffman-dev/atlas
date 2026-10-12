/**
 * Adversarial pass over meeting extraction (P29-05, #18, PR #102): what a
 * sloppy or hostile answer names as an item's owner, and a meeting whose
 * notes hold a fenced line that reads as the transcript's heading. Each test
 * states one invariant ADR-0028's P29-05 addendum gives, and fails on the
 * branch as attacked.
 */
import { describe, expect, it } from 'vitest';
import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { meetingTurnsOf } from '../meetings/meeting-turns.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { CLAUDE_NOTE_CHARACTERS, claudeAsks, type AnsweredNote } from './answered-note.ts';
import { itemOwner, type OwnerDirectory } from './meeting-item-owner.ts';
import type { AnswerContext, CheckedProposal } from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

const person = (name: string, more: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  emails: [],
  aliases: [],
  company: null,
  ...more,
});
const MARA = person('Mara Quill', { emails: ['mara.quill@example.com'] });
const TOBIAS = person('Tobias Fenn', { emails: ['tobias.fenn@example.com'] });
const DIRECTORY: OwnerDirectory = {
  attendees: [
    { name: 'Mara Quill', email: 'mara.quill@example.com', group: false },
    { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    { name: 'Tobias Reed', email: 'tobias.reed@example.com', group: false },
    { name: 'platform-team', email: 'platform-team@example.com', group: true },
  ],
  people: [MARA, TOBIAS, person('Tobias Reed', { emails: ['tobias.reed@example.com'] })],
  selfName: 'Mara Quill',
};

const MEETING = createVaultPath('Meetings/Platform weekly sync.md');
const TEXT = `---
type: meeting
---

## Transcript

**You** [00:00:01] I'll write the rollout note. ^t0001

**Tobias Fenn** [00:00:02] The platform list can chase the vendor. ^t0002
`;
const CONTEXT: AnswerContext = {
  notes: [
    {
      path: MEETING,
      text: TEXT,
      meeting: {
        identity: { provider: 'gemini', externalId: 'gemini-7f3a9c21' },
        attendees: DIRECTORY.attendees,
      },
    },
  ],
  vault: { selfName: 'Mara Quill', people: DIRECTORY.people, notePaths: [MEETING], terms: [] },
};

/** The one proposal an answer of one high-confidence task owned by `owner` makes. */
function taskOwnedBy(owner: string, sourceBlock = 't0002'): CheckedProposal {
  const answer = JSON.stringify({
    items: [
      {
        kind: 'task',
        title: 'Chase the vendor',
        owner,
        source_block: sourceBlock,
        confidence: 'high',
      },
    ],
  });
  const read = proposalSchemaNamed('meeting-items')!.read(answer, CONTEXT);
  if (!read.ok) throw new Error(read.problem);
  expect(read.value).toHaveLength(1);
  return read.value[0]!;
}

describe('whose an item is, when the answer names the owner sloppily', () => {
  // ADR-0028: "`You`, the profile's name, or a name or address the owner's Person note holds: a task at inbox".
  it.each(['mara.quill@example.com', 'Mara Quill <mara.quill@example.com>'])(
    'an address the owner’s own Person note holds is the owner: %s',
    (written) => {
      expect(itemOwner(written, DIRECTORY)).toEqual({ kind: 'self' });
    },
  );

  // Atlas itself tells the model "- Mara Quill: the vault’s owner" and "written “You”": these are its own words back.
  it.each([
    'You.',
    'You (Mara Quill)',
    'Mara Quill (the vault’s owner)',
    'Mara Quill: the vault’s owner',
  ])(
    'the owner written with the punctuation or gloss a model adds is still the owner: %s',
    (written) => {
      expect(itemOwner(written, DIRECTORY)).toEqual({ kind: 'self' });
    },
  );

  it('an address another person’s note holds is that person, as an attendee of that address is', () => {
    expect(itemOwner('tobias.fenn@example.com', DIRECTORY)).toMatchObject({
      kind: 'person',
      person: TOBIAS,
    });
  });
});

describe('attribution that rests on a guess is low confidence, whatever the model claimed', () => {
  it('a first name two attendees share is a guess at which of them', () => {
    const proposal = taskOwnedBy('Tobias');

    expect(proposal.confidence).toBe('low');
  });

  it('does not say there is no Person note for a first name when two people in the meeting have one', () => {
    const proposal = taskOwnedBy('Tobias');

    expect(proposal.why).not.toContain('There is no Person note for Tobias yet');
  });

  it('a group address took nothing on: it is not a high-confidence waiting-for on the group', () => {
    const proposal = taskOwnedBy('platform-team');

    expect(proposal).not.toMatchObject({
      confidence: 'high',
      payload: { properties: { status: 'waiting', waiting_on: 'platform-team' } },
    });
  });
});

describe('a long meeting whose notes hold a fenced line reading “## Transcript”', () => {
  const turn = (id: number) =>
    `**Tobias Fenn** [00:10:00] Turn ${id}. ${'word '.repeat(75)}^t${String(id).padStart(4, '0')}`;
  const long: AnsweredNote = {
    path: MEETING,
    text: [
      '---\ntype: meeting\n---',
      '## Notes',
      '- The export looked like this:',
      '```\n## Transcript\n```',
      '## Transcript',
      ...Array.from({ length: 120 }, (_, at) => turn(at + 1)),
    ].join('\n\n'),
    meeting: { identity: { provider: 'gemini', externalId: 'gemini-7f3a9c21' } },
  };

  it('is read in parts each of which still reads as transcript turns', () => {
    expect(long.text.length).toBeGreaterThan(2 * CLAUDE_NOTE_CHARACTERS);
    // Whole, the meeting reads: the fenced line is no heading.
    expect(meetingTurnsOf(long.text)).toHaveLength(120);

    const { asks } = claudeAsks([long], { inParts: true });

    expect(asks.length).toBeGreaterThan(1);
    const turnsRead = asks.map(([part]) => meetingTurnsOf(part!.text).length);
    expect(turnsRead.every((count) => count > 0)).toBe(true);
    expect(turnsRead.reduce((sum, count) => sum + count, 0)).toBe(120);
  });
});
