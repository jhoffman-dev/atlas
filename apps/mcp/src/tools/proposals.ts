/** Proposals: what Claude or an automation suggested, waiting in the Inbox to be answered. */

import { z } from 'zod';
import { defineTool } from './define.ts';
import { noInput } from './inputs.ts';

const proposalPath = z
  .string()
  .min(1)
  .describe(
    "The proposal's path, under Inbox/Proposals/, exactly as atlas_proposals returned it — " +
      'e.g. "Inbox/Proposals/Send the payroll file.md".',
  );

const REFUSED =
  'Refused with "conflict" and the reason when the vault is not as the proposal expected: it ' +
  'was already accepted or rejected, a note is already where its note would go (it may be the ' +
  'very one proposed), or the note a link proposal changes changed since it was made. A ' +
  'proposal open in Atlas with unsaved typing is refused with "unsaved_in_app".';

/** Answering moves the proposal into the Archive; running it twice is refused, so not idempotent. */
const ANSWERS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

export const proposals = defineTool({
  name: 'atlas_proposals',
  title: 'List open proposals',
  description:
    "List the proposals waiting in Atlas's Inbox (Inbox/Proposals/), newest first: { proposals: " +
    '[{ path, kind, headline, confidence, source, madeBy, payload, modified }], stranded, ' +
    'unreadable }; "stranded" are answered but still in the Inbox. ' +
    '"kind" is task, decision, follow-up, person, link, term or project; "payload" is what ' +
    'accepting writes; "source" is the block it cites, as [[Note#^id]], or null when it cites ' +
    'none. Show James what each would do and what it cites before accepting anything for him.',
  inputSchema: noInput,
  annotations: { readOnlyHint: true },
  call: (client) => client.proposals(),
});

export const acceptProposal = defineTool({
  name: 'atlas_accept_proposal',
  title: 'Accept a proposal',
  description:
    'Accept a proposal as its Accept button in Atlas does: write what its payload says — a new ' +
    "note of its kind's type (a task, follow-up or decision citing its source block), or one link " +
    'added to a relation of a note — then mark it accepted and move it into the Archive. Returns ' +
    '{ accepted: { proposal, headline, archivedAt, archiveProblem, wrote: [{ kind, path }] } }. ' +
    `Only accept what James asked you to. ${REFUSED} Editing a proposal first, and undoing an ` +
    'accept, are done in Atlas.',
  inputSchema: z.object({ path: proposalPath }),
  annotations: ANSWERS,
  call: (client, input) => client.acceptProposal(input.path),
});

export const rejectProposal = defineTool({
  name: 'atlas_reject_proposal',
  title: 'Reject a proposal',
  description:
    'Reject a proposal: nothing it proposed is written; it is marked rejected and moved into ' +
    'the Archive, where it is kept. Returns { rejected: { proposal, archivedAt, archiveProblem } }. ' +
    REFUSED,
  inputSchema: z.object({ path: proposalPath }),
  annotations: ANSWERS,
  call: (client, input) => client.rejectProposal(input.path),
});

export const proposalTools = [proposals, acceptProposal, rejectProposal];
