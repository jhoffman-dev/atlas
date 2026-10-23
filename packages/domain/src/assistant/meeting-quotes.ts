import { sameName } from '../meeting-links/vault-owner.ts';
import type { TranscriptTurn } from '../meetings/transcript.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { turnCitation, type Citation, type LinkTargetOf } from './citation.ts';

/*
 * "What did Mara say about the cut-over?" (P32-04): the turns of a meeting's
 * transcript that answer it, each said by its speaker, in their words, with a
 * link to the turn. Which turns those are is decided here, from the turns as
 * the file holds them; finding the meetings worth reading is the caller's.
 */

/** The most turns one meeting gives: enough to show what was said, not the whole transcript. */
export const QUOTES_PER_MEETING = 5;

/** A quote longer than this is cut, so one long turn cannot fill an answer. */
export const QUOTE_CHARACTERS = 400;

/** The longest `about` the tools take: a question's subject, not a document. */
export const ABOUT_CHARACTERS = 500;

/** One thing said in a meeting. */
export interface SpeakerQuote {
  /** Who said it, as the transcript writes them; `You` for the vault's owner. */
  readonly speaker: string;
  /** When in the meeting, as written (`00:09:44`); null when the turn has no time. */
  readonly time: string | null;
  readonly quote: string;
  /** Whether the quote was cut at {@link QUOTE_CHARACTERS}. */
  readonly cut: boolean;
  readonly cite: Citation;
}

/**
 * Which turns are wanted. Each part left null asks nothing of a turn; a turn
 * is wanted when it meets every part that is set.
 */
export interface TurnFilter {
  /** Turns spoken by someone of one of these names (a person's name and aliases). */
  readonly speakers: readonly string[] | null;
  /** Turns holding every one of these words, as {@link aboutWords} reads them. */
  readonly words: readonly string[] | null;
  /** Turns with one of these block ids: the passages a semantic finder pointed at. */
  readonly blocks: ReadonlySet<string> | null;
}

export const ANY_TURN: TurnFilter = { speakers: null, words: null, blocks: null };

/** Lower case, accents off: how `about` and a turn's words are compared, as the full-text index folds them. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The words of a text as the full-text index splits them: runs of letters and digits. */
function wordsOf(text: string): string[] {
  return folded(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

/**
 * The words `about` asks for, folded; null when it holds none — only
 * punctuation — so nothing can match it.
 */
export function aboutWords(about: string): string[] | null {
  const words = wordsOf(about);
  return words.length === 0 ? null : [...new Set(words)];
}

/** Each word asked for begins a word of the turn: `rollout` finds "rollout" and "rollouts". */
function holdsWords(turn: TranscriptTurn, words: readonly string[]): boolean {
  const spoken = wordsOf(turn.words);
  return words.every((word) => spoken.some((said) => said.startsWith(word)));
}

function spokenBy(turn: TranscriptTurn, names: readonly string[]): boolean {
  const { speaker } = turn;
  return speaker.kind === 'named' && names.some((name) => sameName(speaker.name, name));
}

/** Whether a turn is one the filter wants. */
export function turnWanted(turn: TranscriptTurn, filter: TurnFilter): boolean {
  if (filter.speakers !== null && !spokenBy(turn, filter.speakers)) return false;
  if (filter.words !== null && !holdsWords(turn, filter.words)) return false;
  if (filter.blocks !== null && (turn.blockId === null || !filter.blocks.has(turn.blockId))) {
    return false;
  }
  return true;
}

function quoteOf(words: string): { quote: string; cut: boolean } {
  const text = words.trim();
  if (text.length <= QUOTE_CHARACTERS) return { quote: text, cut: false };
  return { quote: `${text.slice(0, QUOTE_CHARACTERS - 1).trimEnd()}…`, cut: true };
}

/** A meeting's wanted turns, in the order spoken, and how many there were before the cap. */
export interface MeetingQuotes {
  readonly quotes: readonly SpeakerQuote[];
  readonly matched: number;
}

/**
 * The turns of one meeting the filter wants, in the order they were spoken,
 * at most {@link QUOTES_PER_MEETING}, each cited by its block (or, with no
 * id, by the Transcript heading).
 */
export function meetingQuotes({
  path,
  turns,
  filter,
  targetOf,
}: {
  path: VaultPath;
  turns: readonly TranscriptTurn[];
  filter: TurnFilter;
  targetOf: LinkTargetOf;
}): MeetingQuotes {
  const wanted = turns.filter((turn) => turnWanted(turn, filter));
  const quotes = wanted.slice(0, QUOTES_PER_MEETING).map((turn) => ({
    speaker: turn.writtenSpeaker,
    time: turn.time.kind === 'none' ? null : turn.time.text,
    ...quoteOf(turn.words),
    cite: turnCitation(path, turn.blockId, targetOf),
  }));
  return { quotes, matched: wanted.length };
}
