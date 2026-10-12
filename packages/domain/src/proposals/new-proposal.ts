import type { CompiledQuery } from '../query/view-query.ts';
import { fitFileNameStem } from '../vault/file-name-bytes.ts';
import { cleanEntryName } from '../vault/new-note.ts';
import { joinVaultPath, createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  payloadRecord,
  PROPOSAL_TYPE,
  PROPOSALS_FOLDER,
  type ProposalConfidence,
  type ProposalNote,
} from './proposal.ts';

/**
 * The key naming what a proposal is for, so a step that runs again proposes
 * nothing twice — even once the first was answered and archived, since a
 * rejection is an answer too.
 */
export const PROPOSAL_ID_KEY = 'proposal_id';

/** A proposal a step makes, before it is written. */
export type NewProposal = Pick<ProposalNote, 'kind' | 'payload'> & {
  readonly confidence: ProposalConfidence | null;
  /** What it cites, as a link; null when it cites none. */
  readonly source: string | null;
  readonly madeBy: string;
  /** What it is for: the same for the same proposal however often its step runs. */
  readonly id: string;
  /** Its file's name, without `.md`: what it is about, in a few words. */
  readonly name: string;
  /** Why it is proposed, in a sentence or two: the proposal note's body. */
  readonly reason: string;
};

/** A proposal as a note: where it goes in `Inbox/Proposals/`, its frontmatter and its body. */
export interface NewProposalFile {
  readonly path: VaultPath;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/** The note a new proposal is written as, open and waiting in the Inbox (ADR-0028). */
export function proposalFileFor(proposal: NewProposal): NewProposalFile {
  const stem = fitFileNameStem(cleanEntryName(proposal.name) || 'Proposal', '.md');
  return {
    path: joinVaultPath(createVaultPath(PROPOSALS_FOLDER), `${stem}.md`),
    properties: {
      type: PROPOSAL_TYPE,
      kind: proposal.kind,
      state: 'open',
      ...(proposal.confidence !== null && { confidence: proposal.confidence }),
      ...(proposal.source !== null && { source: proposal.source }),
      made_by: proposal.madeBy,
      [PROPOSAL_ID_KEY]: proposal.id,
      payload: payloadRecord(proposal.payload),
    },
    body: proposal.reason === '' ? '' : `${proposal.reason}\n`,
  };
}

/**
 * The proposals, anywhere in the vault — the Archive too, where answered ones
 * go — that are for any of these ids. Columns: path, id. Every id is bound.
 */
export function compileProposalIdsQuery(ids: readonly string[]): CompiledQuery {
  return {
    sql: `/* proposals: ids */ SELECT path AS "path", value_text AS "id" FROM props
 WHERE key = ? AND value_text IN (${ids.map(() => '?').join(', ')}) ORDER BY path`,
    parameters: [PROPOSAL_ID_KEY, ...ids],
  };
}
