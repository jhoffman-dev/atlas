/**
 * What a Claude step's proposal is for (P29-03): the same for the same
 * proposal however often its step runs, so a retry after a half-written run,
 * or a note heard twice, makes it once — even after it was answered and
 * archived, since a rejection is an answer too.
 *
 * The key and the query are the proposals-writer's shared idea: P29-04 (#100)
 * keeps `proposal_id` on a proposal the same way. When both are on `main`,
 * this file's key and query are replaced by that one's (`PROPOSAL_ID_KEY`,
 * `compileProposalIdsQuery`) and the writer by its `writeProposals`: a
 * {@link CheckedProposal} maps to its `NewProposal` field for field
 * (`kind`, `payload`, `confidence`, `source`, `madeBy`, `id`, `name` is the
 * payload's title, `reason` is `why`). Ids written by this step already carry
 * the same key, so nothing already in a vault needs to move.
 */

import { digestOf } from '../sources/merge.ts';
import type { CheckedProposal } from './proposal-schema.ts';

/** The frontmatter key naming what a proposal is for. */
export const CLAUDE_PROPOSAL_ID_KEY = 'proposal_id';

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
 * The proposals, anywhere in the vault — the Archive too, where answered ones
 * go — that are for any of these ids. Columns: path, id. Every id is bound.
 */
export function compileClaudeProposalIdsQuery(ids: readonly string[]): {
  sql: string;
  parameters: string[];
} {
  return {
    sql: `/* proposals: ids */ SELECT path AS "path", value_text AS "id" FROM props
 WHERE key = ? AND value_text IN (${ids.map(() => '?').join(', ')}) ORDER BY path`,
    parameters: [CLAUDE_PROPOSAL_ID_KEY, ...ids],
  };
}
