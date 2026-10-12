/**
 * What Claude suggests for the glossary after a meeting (P29-06, ADR-0028):
 * the `term-suggestions` output. Each item is a spelling in this meeting's
 * transcript that looks like a mishearing of a name — a product, a person, a
 * company, an acronym — with what it should have been and the turn it was
 * heard in.
 *
 * The model says what it heard and what it thinks was meant; whether that may
 * become a term's misheard spelling is decided here, by the rule the Terms
 * page itself would hold a variant to (`suggestedVariantRefusal`) and by the
 * transcript: a spelling that is an everyday word, that is someone's name, or
 * that the cited turn does not hold is left out and reported, and the rest
 * are kept. Each one kept is a `term` proposal. Accepting it adds the spelling
 * to the term — made then, when the vault has none of that name — and nothing
 * in any meeting is rewritten by the suggestion itself.
 */

import { correctTerms } from '../terms/correct-terms.ts';
import { tidySpelling } from '../terms/spelling.ts';
import {
  isKnownSpelling,
  suggestedVariantRefusal,
  type SuggestedVariant,
} from '../terms/term-suggestion.ts';
import { TERM_KIND_KEY, TERMS_FOLDER_NAME, VARIANTS_KEY, type TermKind } from '../terms/term.ts';
import type { Vocabulary } from '../terms/vocabulary.ts';
import { PROPOSAL_CONFIDENCES, type ProposalConfidence } from '../proposals/proposal.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { sameName } from '../meeting-links/vault-owner.ts';
import { truncated } from './answer-limits.ts';
import { citedMeetingTurn, meetingWordsKey } from './meeting-citation.ts';
import {
  isRecord,
  type AnswerContext,
  type DroppedItem,
  type ItemReading,
  type PromptData,
  type ProposalDraft,
  type ProposalSchema,
} from './proposal-schema.ts';

/** What a rule's `output:` calls it. */
export const TERM_SUGGESTIONS_OUTPUT = 'term-suggestions';

/** What a suggested term may name: a term's kinds, less the catch-all, which says nothing. */
export const SUGGESTED_TERM_KINDS = ['product', 'person', 'company', 'acronym'] as const satisfies
  readonly TermKind[];
type SuggestedKind = (typeof SUGGESTED_TERM_KINDS)[number];

/**
 * The most parts of one long meeting the suggestions are read from. A name
 * misheard once is misheard throughout, so the start of a meeting finds most
 * of them, and the asks a long meeting has are better spent on what was
 * agreed in it. Past this the log says the meeting was read in part.
 */
export const TERM_SUGGESTION_PARTS_PER_MEETING = 2;

interface TermSuggestionItem extends SuggestedVariant {
  readonly kind: SuggestedKind;
  readonly sourceBlock: string;
  readonly confidence: ProposalConfidence;
}

const EMPTY_VOCABULARY: Pick<Vocabulary, 'entries' | 'conflicts'> = { entries: [], conflicts: [] };

const dropped = (problem: string): { ok: false; problem: string; drop: true } => ({
  ok: false,
  problem,
  drop: true,
});

/** One item of the answer. What is wrong with an item alone leaves out that item, and is reported. */
function readSuggestion(value: unknown): ItemReading<TermSuggestionItem> {
  if (!isRecord(value)) return dropped('It is not an object.');
  const { heard, canonical, source_block: sourceBlock } = value;
  if (typeof heard !== 'string' || tidySpelling(heard) === '') return dropped('It has no "heard".');
  if (typeof canonical !== 'string' || tidySpelling(canonical) === '') {
    return dropped('It has no "canonical".');
  }
  const kind = SUGGESTED_TERM_KINDS.find((known) => known === value['kind']);
  if (kind === undefined) {
    return dropped(`Its kind is not one of ${SUGGESTED_TERM_KINDS.join(', ')}.`);
  }
  if (typeof sourceBlock !== 'string') return dropped('It has no "source_block".');
  const confidence = PROPOSAL_CONFIDENCES.find((known) => known === value['confidence']);
  if (confidence === undefined) {
    return dropped(`Its confidence is not one of ${PROPOSAL_CONFIDENCES.join(', ')}.`);
  }
  return {
    ok: true,
    value: {
      heard: tidySpelling(heard),
      canonical: tidySpelling(canonical),
      kind,
      sourceBlock,
      confidence,
    },
  };
}

/** An item as the log names it: what was heard, and what it was taken for. */
const named = ({ heard, canonical }: SuggestedVariant): string =>
  `${truncated(heard, 50)} → ${truncated(canonical, 50)}`;

/**
 * Whether the cited turn holds the spelling as the correction would find it
 * there: as whole words, as written, outside a link or code — in what was
 * said, or in the speaker's label, which is corrected like the words.
 */
function heardIn(turn: { words: string; writtenSpeaker: string }, item: SuggestedVariant): boolean {
  const entries = [{ form: item.heard, canonical: item.canonical, claims: [] }];
  return [turn.words, turn.writtenSpeaker].some(
    (text) => correctTerms(text, { entries }).changes.length > 0,
  );
}

/**
 * Why a suggestion is left out, or null when it is kept: it cites no turn of
 * the meeting, the turn it cites does not hold the spelling, or the spelling
 * may not be a variant (`suggestedVariantRefusal`).
 */
function droppedSuggestion(item: TermSuggestionItem, context: AnswerContext): DroppedItem | null {
  const left = (reason: string): DroppedItem => ({ title: named(item), reason });
  const cited = citedMeetingTurn(item.sourceBlock, context);
  if (!cited.ok) return left(cited.reason);
  if (!heardIn(cited.turn, item)) {
    return left(
      `The turn it cites does not hold “${truncated(item.heard, 50)}” as written, so there is nothing there to correct.`,
    );
  }
  const refusal = suggestedVariantRefusal(item, context.vault?.vocabulary ?? EMPTY_VOCABULARY);
  return refusal === null ? null : left(refusal);
}

/** Whether the right spelling is a name the run can vouch for: the vocabulary's, or an attendee's. */
function isVouchedFor(item: TermSuggestionItem, context: AnswerContext): boolean {
  if (isKnownSpelling(item.canonical, context.vault?.vocabulary ?? EMPTY_VOCABULARY)) return true;
  return context.notes.some((note) =>
    (note.meeting?.attendees ?? []).some((attendee) => sameName(attendee.name, item.canonical)),
  );
}

function draftsOfSuggestion(item: TermSuggestionItem, context: AnswerContext): ProposalDraft[] {
  const cited = citedMeetingTurn(item.sourceBlock, context);
  // A suggestion that cites no turn was left out before this is asked.
  if (!cited.ok) return [];
  const vouched = isVouchedFor(item, context);
  const doubt = vouched
    ? ''
    : ` “${item.canonical}” is not a name the vault or the meeting's attendees have, so check the spelling.`;
  return [
    {
      kind: 'term',
      payload: {
        title: item.canonical,
        folder: TERMS_FOLDER_NAME,
        properties: { [TERM_KIND_KEY]: item.kind, [VARIANTS_KEY]: [item.heard] },
      },
      source: cited.source,
      // A right spelling nobody can vouch for is the model's own: a guess, whatever it claimed.
      confidence: vouched ? item.confidence : 'low',
      why:
        `Heard “${item.heard}” in ${noteTitle(cited.meeting.path)}, which looks like a mishearing of ${item.canonical} (${aKind(item.kind)}).${doubt} ` +
        `Accepting adds it to that term’s misheard spellings, making the term if there is none. ` +
        `Meetings that arrive after are corrected by it; one already here only when you choose Correct again on it.`,
      distinguishedBy: item.heard,
    },
  ];
}

const aKind = (kind: SuggestedKind): string => (kind === 'acronym' ? 'an acronym' : `a ${kind}`);

/** The most of each list of names a prompt carries: spellings, not a document. */
const MAX_NAMES_SHOWN = 300;

/**
 * What the model is told beside a meeting, as data: who was in it, the names
 * of the vault's people and companies, and its terms — each with the
 * mishearings already listed, so it suggests none of those again.
 */
function suggestionData(context: AnswerContext): PromptData[] {
  const meetings = context.notes.filter((note) => note.meeting !== undefined);
  if (meetings.length === 0) return [];
  const attendees = meetings.flatMap((note) =>
    (note.meeting?.attendees ?? []).filter(({ group }) => !group).map(({ name }) => name),
  );
  const { terms, people, companies } = knownNames(context.vault?.vocabulary);
  const lists: PromptData[] = [
    { about: 'who was in the meeting', text: [...new Set(attendees)].join('\n') },
    { about: 'terms: the right spelling, then the mishearings already known', text: terms },
    { about: 'the names of people in the vault', text: people },
    { about: 'the names of companies in the vault', text: companies },
  ];
  return lists.filter(({ text }) => text !== '');
}

/** The vocabulary as three lists of lines: its terms with their known mishearings, its people, its companies. */
function knownNames(vocabulary: Vocabulary | undefined): {
  terms: string;
  people: string;
  companies: string;
} {
  const terms = new Map<string, string[]>();
  const people = new Set<string>();
  const companies = new Set<string>();
  for (const { form, canonical, claims } of vocabulary?.entries ?? []) {
    for (const { source } of claims) {
      if (source === 'person') people.add(canonical);
      else if (source === 'company') companies.add(canonical);
      else terms.set(canonical, [...(terms.get(canonical) ?? []), ...(form === canonical ? [] : [form])]);
    }
  }
  const lines = (names: Iterable<string>) => [...names].sort().slice(0, MAX_NAMES_SHOWN).join('\n');
  return {
    terms: lines(
      [...terms].map(([canonical, heard]) =>
        heard.length === 0 ? canonical : `${canonical} ← ${[...new Set(heard)].join(', ')}`,
      ),
    ),
    people: lines(people),
    companies: lines(companies),
  };
}

export const TERM_SUGGESTIONS: ProposalSchema<TermSuggestionItem> = {
  name: TERM_SUGGESTIONS_OUTPUT,
  key: 'terms',
  itemShape:
    '{ "heard": the spelling exactly as the transcript has it, capitals included; ' +
    '"canonical": what it should have been, spelt as the names and terms you were given spell it; ' +
    `"kind": one of ${SUGGESTED_TERM_KINDS.join(', ')}; "source_block": a turn that holds the heard spelling; ` +
    '"confidence": high, medium or low }.',
  itemKeys: ['heard', 'canonical', 'kind', 'source_block', 'confidence'],
  citation:
    '"source_block" is the id at the end of one transcript turn that holds the heard spelling, as written there without its ^: "t0004". ' +
    'Only a turn of the Transcript you were shown counts. A suggestion whose turn does not hold the spelling is left out.',
  readItem: readSuggestion,
  sharedAcrossRules: true,
  sharedAcrossNotes: true,
  handledKeyOf: meetingWordsKey,
  dropsUnreadable: true,
  dropped: droppedSuggestion,
  draftsOf: draftsOfSuggestion,
  readsVault: true,
  readsInParts: true,
  partsPerNote: TERM_SUGGESTION_PARTS_PER_MEETING,
  dataFor: suggestionData,
};
