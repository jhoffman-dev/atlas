/**
 * A Claude step's proposal (P29-03) as the proposals writer takes it
 * (`NewProposal`, P29-04): one writer makes every proposal DFAI proposes,
 * and its `proposal_id` is what keeps a proposal from being made twice.
 *
 * The id is the same for the same proposal however often its step runs, so a
 * retry after a half-written run, or a note heard twice, makes it once — even
 * after it was answered and archived, since a rejection is an answer too.
 */

import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { NewProposal } from '../proposals/new-proposal.ts';
import { digestOf } from '../sources/merge.ts';
import { glossaryKey } from '../terms/spelling-folds.ts';
import type { CheckedProposal } from './proposal-schema.ts';

/**
 * The id of a proposal one rule's step makes: its rule, what it proposes and
 * the block it cites — the block as the run resolved it (`cites`), never the
 * link as the model worded it, so `[[Standup#^t1]]`, `[[Inbox/Meetings/
 * Standup.md#^t1]]` and the same turn of the same meeting once it is renamed
 * and filed are one proposal. A meeting the import let in is known by its
 * provider and id, which filing does not change; any other note by its path.
 * What tells two items of one title on one turn apart (`distinguishedBy`, who
 * they concern) is part of it. Two hashes of the same text, so a collision (a 32-bit hash alone would meet
 * one in a large vault) needs both to meet.
 *
 * A term a meeting schema suggests (#19, a schema whose proposals are shared
 * across rules) is the glossary's, not a meeting's: it is known by its right
 * spelling alone (`glossaryKey`: case, a possessive and Latin accents aside,
 * never a plural), so a term proposed once — and one rejected — is never
 * proposed again, by a re-run or by the next meeting that mishears it. A
 * term any other schema proposes keeps the rule- and citation-scoped id.
 */
export function claudeProposalId({
  rule,
  proposal,
}: {
  rule: string;
  proposal: CheckedProposal;
}): string {
  if (proposal.kind === 'term' && proposal.sharedAcrossRules) {
    return idOf(['', 'term', glossaryKey(proposal.payload.title)].join('\n'));
  }
  const title = proposal.payload.title.replace(/\s+/g, ' ').trim().toLowerCase();
  const { note, meeting, block } = proposal.cites;
  // JSON, so no spelling of one part can be taken for another's.
  const cited =
    meeting === null
      ? JSON.stringify(['note', note])
      : JSON.stringify(['meeting', meeting.provider, meeting.externalId.trim()]);
  // A schema whose proposals are the meeting's, not the rule's, leaves the rule out: two rules make each once.
  const scope = proposal.sharedAcrossRules ? '' : rule;
  return idOf([scope, proposal.kind, title, proposal.distinguishedBy, cited, block].join('\n'));
}

function idOf(what: string): string {
  return `claude-${digestOf(`a${what}`)}${digestOf(`b${what}`)}`;
}

/**
 * What a task made from a meeting's action item is known by, its
 * `atlas_item` (ADR-0036): the meeting the item was read from (provider and
 * id; only the primary, first-imported copy makes tasks, and a block id means
 * nothing in another copy's transcript), the block it cites and whose it is
 * (as the item's proposal is distinguished by). Never the title, whose
 * wording changes from one answer to the next, so a retitled item is the
 * same item. Two hashes, as for {@link claudeProposalId}.
 */
export function atlasItemKey({
  meeting,
  block,
  owner,
}: {
  meeting: MeetingIdentity;
  block: string;
  owner: string;
}): string {
  // JSON, so no spelling of one part can be taken for another's.
  const what = JSON.stringify([meeting.provider, meeting.externalId.trim(), block, owner]);
  return `item-${digestOf(`a${what}`)}${digestOf(`b${what}`)}`;
}

/**
 * A checked proposal as the writer takes it: named for the note it would
 * make, saying why in its body, and carrying what made it so the Inbox can
 * say where it came from.
 */
export function claudeNewProposal({
  rule,
  madeBy,
  proposal,
}: {
  /** The rule's id: what its proposals are for. */
  rule: string;
  /** The rule and run, as the proposal's `made_by` says it. */
  madeBy: string;
  proposal: CheckedProposal;
}): NewProposal {
  return {
    kind: proposal.kind,
    payload: proposal.payload,
    confidence: proposal.confidence,
    source: proposal.source,
    madeBy,
    id: claudeProposalId({ rule, proposal }),
    name: proposal.payload.title,
    reason: proposal.why,
  };
}
