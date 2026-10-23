/**
 * A meeting's suggested glossary terms (#19): the `term` items of a
 * `meeting-items` or `meeting-digest` answer. The model names words in a
 * transcript turn that look like a misheard name, product or piece of jargon,
 * and what they should have been; DFAI decides whether that is proposed. An
 * accepted term is a note in Terms whose variant is what was heard, so the
 * next meeting's correction (`correctTerms`) puts those words right.
 */

import type { TranscriptTurn } from '../meetings/transcript.ts';
import type { ProposalConfidence } from '../proposals/proposal.ts';
import { correctTerms } from '../terms/correct-terms.ts';
import { tidySpelling } from '../terms/spelling.ts';
import { TERMS_FOLDER, VARIANTS_KEY } from '../terms/term.ts';
import { suggestedTermRefusal } from '../terms/term-suggestion.ts';
import { truncated } from './answer-limits.ts';
import type { AnswerContext, ProposalDraft } from './proposal-schema.ts';

/** What a term item says, as read from the answer. */
export interface TermItem {
  /** The right spelling: what the term is called once accepted. */
  readonly title: string;
  /** The words as the cited turn has them. */
  readonly heard: string;
  readonly confidence: ProposalConfidence;
}

const EMPTY_VOCABULARY = { entries: [], conflicts: [] };

/**
 * Why a term item is left out, or null when it is proposed: the suggestion
 * must pass the glossary's rules (`suggestedTermRefusal`: no everyday words,
 * nothing the vault already spells), and what was heard must stand in the
 * turn it cites exactly as correction would find it there — else the variant
 * would correct nothing.
 */
export function termItemRefusal(
  item: TermItem,
  turn: Pick<TranscriptTurn, 'words' | 'blockId'>,
  context: AnswerContext,
): string | null {
  const suggestion = { heard: tidySpelling(item.heard), canonical: tidySpelling(item.title) };
  const refusal = suggestedTermRefusal(suggestion, context.vault?.vocabulary ?? EMPTY_VOCABULARY);
  if (refusal !== null) return refusal;
  const entry = { form: suggestion.heard, canonical: suggestion.canonical, claims: [] };
  if (correctTerms(turn.words, { entries: [entry] }).changes.length > 0) return null;
  return `“${truncated(suggestion.heard, 80)}” is not said in turn ^${turn.blockId ?? ''} as written.`;
}

/** What a term item proposes: a term of the right spelling, misheard as the words the turn has. */
export function termDraft({
  item,
  source,
  from,
}: {
  item: TermItem;
  /** The cited turn, as a link: `[[2026-10-06 Standup#^t0002]]`. */
  source: string;
  /** The title of the meeting it was heard in. */
  from: string;
}): ProposalDraft {
  const heard = tidySpelling(item.heard);
  const title = tidySpelling(item.title);
  return {
    kind: 'term',
    payload: { title, folder: TERMS_FOLDER, properties: { [VARIANTS_KEY]: [heard] } },
    source,
    confidence: item.confidence,
    why: `Heard as “${heard}” in ${from}. Accepted, “${title}” joins Terms, and the next meeting’s transcript is put right.`,
  };
}
