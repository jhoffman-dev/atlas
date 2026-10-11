import { blockIdAtEnd } from '../markdown/block-anchor.ts';
import { digestOf } from '../sources/merge.ts';
import { correctTerms, type TermChange } from '../terms/correct-terms.ts';
import type { Vocabulary } from '../terms/vocabulary.ts';
import { splitMeetingSections } from './meeting-sections.ts';

/** The frontmatter list of what the correction changed, or `undone` once it was taken back. */
export const CORRECTIONS_KEY = 'atlas_corrections';
/** The digest of the body as the correction wrote it: what undo checks the body is still. */
export const CORRECTIONS_DIGEST_KEY = 'atlas_corrections_digest';
/** What `atlas_corrections` says once the corrections were undone, so they are never made again. */
export const CORRECTIONS_UNDONE = 'undone';

/** One spelling put right, every time it was, as the meeting's frontmatter records it. */
export interface CorrectionRecord {
  /** The words exactly as the meeting had them. */
  readonly from: string;
  readonly to: string;
  readonly count: number;
  /** The block ids of the paragraphs, turns and steps it was put right in, each once. */
  readonly blocks: readonly string[];
  /** Where each corrected spelling starts in the body as corrected, in UTF-16 units. */
  readonly at: readonly number[];
}

export interface MeetingCorrection {
  /** The body with its sections corrected. */
  readonly body: string;
  /** Grouped by what was written and what it became, in the order each first comes. */
  readonly records: readonly CorrectionRecord[];
  /** How many spellings were put right. */
  readonly count: number;
}

/**
 * A meeting's body with the vocabulary's spellings put right in its Summary,
 * Notes, Provider next steps and Transcript (P28-06) — never in the title or
 * anything before the first section — and what changed, as its frontmatter
 * records it. Every byte outside a corrected spelling is as it was.
 */
export function correctMeetingBody(
  body: string,
  vocabulary: Pick<Vocabulary, 'entries'>,
): MeetingCorrection {
  const lineStarts = lineStartsOf(body);
  const changes: (TermChange & { readonly blockId: string | null })[] = [];
  for (const section of splitMeetingSections(body, 1).sections) {
    // The section's text starts on the line after its heading.
    const start = lineStarts[section.headingLine + 1] ?? body.length;
    const corrected = correctTerms(section.text, vocabulary);
    for (const change of corrected.changes) {
      changes.push({
        ...change,
        start: start + change.start,
        end: start + change.end,
        blockId: blockIdAround(section.text, change.start),
      });
    }
  }
  return correctionOf(body, changes);
}

function correctionOf(
  body: string,
  changes: readonly (TermChange & { readonly blockId: string | null })[],
): MeetingCorrection {
  const records = new Map<string, { from: string; to: string; blocks: string[]; at: number[] }>();
  let corrected = '';
  let read = 0;
  for (const change of changes) {
    corrected += body.slice(read, change.start);
    const key = JSON.stringify([change.from, change.to]);
    const record = records.get(key) ?? { from: change.from, to: change.to, blocks: [], at: [] };
    records.set(key, record);
    record.at.push(corrected.length);
    if (change.blockId !== null && !record.blocks.includes(change.blockId)) {
      record.blocks.push(change.blockId);
    }
    corrected += change.to;
    read = change.end;
  }
  return {
    body: corrected + body.slice(read),
    records: [...records.values()].map((record) => ({ ...record, count: record.at.length })),
    count: changes.length,
  };
}

/** Where each 1-based line of the text starts: index n is line n's start (index 0 is unused). */
function lineStartsOf(text: string): number[] {
  const starts = [0, 0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

const BLANK_LINE = /\n[ \t\r]*\n/g;

/** The id of the block — the run of lines between blank ones — holding `at`, or null when it has none. */
function blockIdAround(text: string, at: number): string | null {
  let start = 0;
  let end = text.length;
  for (const blank of text.matchAll(BLANK_LINE)) {
    const blankEnd = blank.index + blank[0].length;
    if (blankEnd <= at) start = blankEnd;
    else if (blank.index >= at) {
      end = blank.index;
      break;
    }
  }
  return blockIdAtEnd(text.slice(start, end).trimEnd())?.id ?? null;
}

/** What the frontmatter is changed by when a meeting's words were corrected. */
export function correctionProperties(correction: MeetingCorrection): Record<string, unknown> {
  return {
    [CORRECTIONS_KEY]: correction.records.map(({ from, to, count, blocks, at }) => ({
      from,
      to,
      count,
      blocks: [...blocks],
      at: [...at],
    })),
    [CORRECTIONS_DIGEST_KEY]: digestOf(correction.body),
  };
}

/** What the frontmatter is changed by once the corrections are undone. */
export const UNDONE_CORRECTION_PROPERTIES: Readonly<Record<string, unknown>> = {
  [CORRECTIONS_KEY]: CORRECTIONS_UNDONE,
  [CORRECTIONS_DIGEST_KEY]: null,
};

/** Whether a meeting was corrected already — or its corrections undone — so it is never corrected again. */
export function wasCorrected(properties: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(properties, CORRECTIONS_KEY);
}

/**
 * The corrections a meeting's frontmatter records, or null when it records
 * none that undo could take back: none made, undone, or written in a shape
 * the correction never writes. A frontmatter is text anyone can edit, so
 * nothing in it is believed until it is checked.
 */
export function recordedCorrections(
  properties: Readonly<Record<string, unknown>>,
): readonly CorrectionRecord[] | null {
  const value = properties[CORRECTIONS_KEY];
  if (!Array.isArray(value) || value.length === 0) return null;
  const records = value.map(recordOf);
  return records.every((record) => record !== null) ? records : null;
}

function recordOf(value: unknown): CorrectionRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { from, to, count, blocks, at } = value as Record<string, unknown>;
  const isText = (each: unknown): each is string => typeof each === 'string' && each !== '';
  const isOffset = (each: unknown): each is number =>
    Number.isSafeInteger(each) && Number(each) >= 0;
  if (!isText(from) || !isText(to) || !Array.isArray(at) || !at.every(isOffset)) return null;
  if (count !== at.length || !Array.isArray(blocks) || !blocks.every(isText)) return null;
  return { from, to, count, blocks, at };
}

/** The original body of a corrected meeting, or why it cannot be had back. */
export type CorrectionUndo =
  { readonly ok: true; readonly body: string } | { readonly ok: false; readonly reason: string };

/**
 * The meeting's body as it was before its words were corrected, every byte
 * (P28-06). Refused — and nothing changed — when the body is not the one the
 * correction wrote, as automation undo refuses a note changed since its run:
 * putting words back into text someone has since edited could undo their
 * edit. A change to the frontmatter alone does not stop it.
 */
export function undoMeetingCorrections({
  body,
  properties,
}: {
  body: string;
  properties: Readonly<Record<string, unknown>>;
}): CorrectionUndo {
  const records = recordedCorrections(properties);
  if (records === null) return refused('This meeting has no corrections to undo.');
  if (properties[CORRECTIONS_DIGEST_KEY] !== digestOf(body)) {
    return refused(
      'The meeting changed since its words were corrected, so they were left as they are.',
    );
  }
  const spots = records
    .flatMap(({ from, to, at }) => at.map((start) => ({ start, from, to })))
    .sort((left, right) => left.start - right.start);
  let original = '';
  let read = 0;
  for (const { start, from, to } of spots) {
    if (start < read || body.slice(start, start + to.length) !== to) {
      return refused(
        'The corrections recorded on this meeting do not match its words, so nothing was undone.',
      );
    }
    original += body.slice(read, start) + from;
    read = start + to.length;
  }
  return { ok: true, body: original + body.slice(read) };
}

const refused = (reason: string): CorrectionUndo => ({ ok: false, reason });
