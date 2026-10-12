/**
 * Adversarial pass over the meeting a Claude step's proposal links back to
 * (ADR-0028, "One writer, and the meeting a proposal came from"): one run
 * reads two meetings with the same title, filed in different folders, and the
 * answer cites one by its title, as the step's instructions tell it to.
 *
 * Fails on p29-03.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { AnsweredNote } from './answered-note.ts';
import { checkDraft, type ProposalDraft } from './proposal-schema.ts';

const TURN = '\n## Transcript\n\n**Mara Quill** [~00:00:00] Send me the payroll file. ^t0001\n';

const meetingAt = (path: string, externalId: string): AnsweredNote => ({
  path: createVaultPath(path),
  text: `---\ntype: meeting\n---\n${TURN}`,
  meeting: { identity: { provider: 'gemini', externalId } },
});

/** Two weeklies on one day, for two clients: one filed already, one just arrived. */
const ALDER = meetingAt('Meetings/Alder/2026-10-06 Weekly.md', 'gemini-alder');
const LARKSPUR = meetingAt('Inbox/Meetings/2026-10-06 Weekly.md', 'gemini-larkspur');

const draft: ProposalDraft = {
  kind: 'task',
  payload: { title: 'Send Mara the payroll file' },
  source: '[[2026-10-06 Weekly#^t0001]]',
  confidence: 'high',
  why: 'Mara asked for it.',
  joinsMeeting: 'tasks',
};

describe('a draft citing a title two of the run’s meetings share', () => {
  it('is not linked to whichever meeting the run happened to read first', () => {
    const one = checkDraft(draft, { notes: [ALDER, LARKSPUR] }, ['tasks']);
    const other = checkDraft(draft, { notes: [LARKSPUR, ALDER] }, ['tasks']);

    // Which meeting an answer means cannot hang on the order the notes were read in:
    // the same answer names the same meeting, or is refused as naming neither.
    const linked = (reading: typeof one) =>
      reading.ok ? reading.value.payload.linkFrom?.meeting?.externalId : 'refused';
    expect(linked(one)).toBe(linked(other));
  });
});
