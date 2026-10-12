/**
 * A Claude step's proposal (P29-03) as the proposals writer takes it
 * (`NewProposal`, P29-04): one writer makes every proposal Atlas proposes,
 * and its `proposal_id` is what keeps a proposal from being made twice.
 *
 * The id is the same for the same proposal however often its step runs, so a
 * retry after a half-written run, or a note heard twice, makes it once — even
 * after it was answered and archived, since a rejection is an answer too.
 */

import type { NewProposal } from '../proposals/new-proposal.ts';
import { digestOf } from '../sources/merge.ts';
import type { CheckedProposal } from './proposal-schema.ts';

/**
 * The id of a proposal one rule's step makes: its rule, what it proposes and
 * the block it cites. Two hashes of the same text, so a collision (a 32-bit
 * hash alone would meet one in a large vault) needs both to meet.
 */
export function claudeProposalId({
  rule,
  proposal,
}: {
  rule: string;
  proposal: CheckedProposal;
}): string {
  const title = proposal.payload.title.replace(/\s+/g, ' ').trim().toLowerCase();
  const what = [rule, proposal.kind, title, proposal.source].join('\n');
  return `claude-${digestOf(`a${what}`)}${digestOf(`b${what}`)}`;
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
