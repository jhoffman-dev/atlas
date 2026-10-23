import {
  acceptedTermRefusal,
  isProposalPath,
  linkTakeover,
  newNotePath,
  noteTitle,
  VARIANTS_KEY,
  type ProposalNote,
  type VaultPath,
} from '@dfai/domain';
import { ProposalRefused } from '../chat/proposals.ts';
import type { IndexPort } from '../index/ports.ts';
import { loadTerms } from '../terms/terms.ts';

/**
 * Refuses to accept a term proposal (#19) the vault has moved past since it
 * was made: its spelling is in the glossary now, one of its misheard
 * spellings is now another note's, or the new term would take over the
 * `[[links]]` of a note of the same name — as adding a term on the Terms page
 * refuses. Read from the vocabulary as it is at Accept, never as it was.
 */
export async function refuseOutdatedTerm(
  { index }: { index: Pick<IndexPort, 'query'> },
  { proposal, notePaths }: { proposal: ProposalNote; notePaths: readonly VaultPath[] },
): Promise<void> {
  if (proposal.kind !== 'term') return;
  const { title, properties } = proposal.payload;
  const variants = properties[VARIANTS_KEY];
  const { vocabulary } = await loadTerms({ index });
  const refusal = acceptedTermRefusal(
    {
      canonical: title,
      variants: Array.isArray(variants) ? variants.filter((v) => typeof v === 'string') : [],
    },
    vocabulary,
  );
  if (refusal !== null) throw new ProposalRefused(refusal);
  const path = newNotePath(proposal.payload);
  // A proposal note is filed in the Archive as it is accepted: its name is no note's links.
  const overtaken = linkTakeover(
    path,
    notePaths.filter((note) => !isProposalPath(note)),
  );
  if (overtaken !== null) {
    throw new ProposalRefused(
      `[[${noteTitle(path)}]] already opens ${overtaken}, and would open the new term instead. Rename one of them first.`,
    );
  }
}
