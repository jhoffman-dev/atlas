import { blockIdAtEnd } from '../markdown/block-anchor.ts';
import { correctTerms, type TermChange } from '../terms/correct-terms.ts';
import { vocabularyKey } from '../terms/spelling.ts';
import type { Vocabulary } from '../terms/vocabulary.ts';
import { correctionDigestOf } from './correction-digest.ts';
import { splitMeetingSections } from './meeting-sections.ts';
import { summaryBlockSpan } from './meeting-summary-block.ts';

/** The frontmatter list of what the correction changed, or `undone` once it was taken back. */
export const CORRECTIONS_KEY = 'atlas_corrections';
/** The digest of the body as the correction wrote it: what undo checks the body is still. */
export const CORRECTIONS_DIGEST_KEY = 'atlas_corrections_digest';
/** The digest of the body as it was before: what undo checks the body it rebuilds is. */
export const CORRECTIONS_ORIGINAL_DIGEST_KEY = 'atlas_corrections_original_digest';
/** What `atlas_corrections` says once the corrections were undone, so they are never made again. */
export const CORRECTIONS_UNDONE = 'undone';
/** What `atlas_corrections` says when the meeting was read and held nothing to correct. */
export const CORRECTIONS_NONE = 'none';

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
  /** The digest of the corrected body, its summary block left out: what undo checks the body is still. */
  readonly digest: string;
  /** The digest of the body before it was corrected, its summary block left out. */
  readonly originalDigest: string;
}

/**
 * A meeting's body apart from its summary block (#185): what a correction
 * reads, records its offsets in and takes its digests of, so Claude's block —
 * written, rewritten or taken out after the correction, or there before it —
 * neither moves the record nor is ever corrected itself.
 */
interface BodyApart {
  /** The body without the block. */
  readonly text: string;
  /** The block, with the line breaks after it, and where in `text` it stood; null when there is none. */
  readonly block: { readonly text: string; readonly at: number } | null;
}

function apartFromSummary(body: string): BodyApart {
  const span = summaryBlockSpan(body);
  if (span === null) return { text: body, block: null };
  return {
    text: body.slice(0, span.start) + body.slice(span.end),
    block: { text: body.slice(span.start, span.end), at: span.start },
  };
}

/**
 * `text` with the block put back where it stood, `at` moved by every edit
 * made before it: each one's `start` in the text the block was taken from,
 * and how many characters longer it made the text.
 */
function withBlockBack(
  text: string,
  block: BodyApart['block'],
  edits: readonly { readonly start: number; readonly grew: number }[],
): string {
  if (block === null) return text;
  const at = edits.reduce(
    (moved, edit) => (edit.start < block.at ? moved + edit.grew : moved),
    block.at,
  );
  return text.slice(0, at) + block.text + text.slice(at);
}

/**
 * A meeting's body with the vocabulary's spellings put right in its Summary,
 * Notes, Provider next steps and Transcript (P28-06) — never in the title or
 * anything before the first section — and what changed, as its frontmatter
 * records it. Every byte outside a corrected spelling is as it was.
 *
 * A turn's speaker label that is exactly what a person goes by (their name
 * or an alias, `vocabulary.speakers`) names that person, and is what links
 * the turn to them. It is left as heard where a term would make it a
 * spelling that is not theirs (`Toby`, Tobias Fenn's alias, into the product
 * `Tobi`); it is still put right into one that is (`Mara Quil` into `Mara
 * Quill`).
 */
export function correctMeetingBody(
  body: string,
  vocabulary: Pick<Vocabulary, 'entries'> & Partial<Pick<Vocabulary, 'speakers'>>,
): MeetingCorrection {
  const apart = apartFromSummary(body);
  const changes = sectionChanges(apart.text, vocabulary);
  const correction = correctionOf(apart.text, changes);
  const edits = changes.map(({ start, end, to }) => ({ start, grew: to.length - (end - start) }));
  return { ...correction, body: withBlockBack(correction.body, apart.block, edits) };
}

/** Each spelling to put right in the body's sections, where it stands in the body. */
function sectionChanges(
  body: string,
  vocabulary: Pick<Vocabulary, 'entries'> & Partial<Pick<Vocabulary, 'speakers'>>,
): (TermChange & { readonly blockId: string | null })[] {
  const lineStarts = lineStartsOf(body);
  const changes: (TermChange & { readonly blockId: string | null })[] = [];
  for (const section of splitMeetingSections(body, 1).sections) {
    // The section's text starts on the line after its heading.
    const start = lineStarts[section.headingLine + 1] ?? body.length;
    const corrected = correctTerms(section.text, vocabulary);
    const blockIdAt = blockIdFinder(section.text);
    const kept =
      section.name === 'transcript'
        ? labelsKept(section.text, corrected.changes, vocabulary.speakers)
        : [];
    for (const change of corrected.changes) {
      if (kept.some(({ start, end }) => change.start >= start && change.end <= end)) continue;
      changes.push({
        ...change,
        start: start + change.start,
        end: start + change.end,
        blockId: blockIdAt(change.start),
      });
    }
  }
  return changes;
}

/** `**Speaker**` at the start of a line, as the transcript's turns are read. */
const SPEAKER_LABEL = /^\*\*([^*\n]+)\*\*/gm;

/**
 * Where the transcript's speaker labels to leave as heard sit in its text:
 * those someone goes by, which the changes would turn into a spelling not
 * every one of those people goes by.
 */
function labelsKept(
  text: string,
  changes: readonly TermChange[],
  speakers: Vocabulary['speakers'] | undefined,
): { start: number; end: number }[] {
  if (speakers === undefined || speakers.size === 0 || changes.length === 0) return [];
  const kept: { start: number; end: number }[] = [];
  for (const label of text.matchAll(SPEAKER_LABEL)) {
    const heard = speakers.get(vocabularyKey(label[1] ?? ''));
    if (heard === undefined) continue;
    const start = label.index + 2;
    const end = start + (label[1] ?? '').length;
    const within = changes.filter((change) => change.start >= start && change.end <= end);
    if (within.length === 0) continue;
    const theirs = speakers.get(vocabularyKey(rewritten(text, { start, end }, within))) ?? [];
    if (!heard.every((person) => theirs.includes(person))) kept.push({ start, end });
  }
  return kept;
}

/** A stretch of the text as the changes inside it would leave it. */
function rewritten(
  text: string,
  { start, end }: { start: number; end: number },
  changes: readonly TermChange[],
): string {
  let written = '';
  let read = start;
  for (const change of changes) {
    written += text.slice(read, change.start) + change.to;
    read = change.end;
  }
  return written + text.slice(read, end);
}

/** A record while its changes are gathered: the blocks a set, so each is added once in constant time. */
interface WorkingRecord {
  readonly from: string;
  readonly to: string;
  readonly blocks: Set<string>;
  readonly at: number[];
}

function correctionOf(
  body: string,
  changes: readonly (TermChange & { readonly blockId: string | null })[],
): MeetingCorrection {
  const records = new Map<string, WorkingRecord>();
  let corrected = '';
  let read = 0;
  for (const change of changes) {
    corrected += body.slice(read, change.start);
    const key = JSON.stringify([change.from, change.to]);
    const record = records.get(key) ?? {
      from: change.from,
      to: change.to,
      blocks: new Set<string>(),
      at: [],
    };
    records.set(key, record);
    record.at.push(corrected.length);
    if (change.blockId !== null) record.blocks.add(change.blockId);
    corrected += change.to;
    read = change.end;
  }
  const written = corrected + body.slice(read);
  return {
    body: written,
    records: [...records.values()].map((record) => ({
      ...record,
      blocks: [...record.blocks],
      count: record.at.length,
    })),
    count: changes.length,
    digest: correctionDigestOf(written),
    originalDigest: correctionDigestOf(body),
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

/**
 * Finds the id of the block — the run of lines between blank ones — holding
 * an offset, or null when it has none. The blank lines are found once for the
 * section, and each lookup is a binary search, so a section of any size is
 * read in time that grows with its length and not with changes times blocks.
 */
function blockIdFinder(text: string): (at: number) => string | null {
  const blanks = [...text.matchAll(BLANK_LINE)].map((blank) => ({
    start: blank.index,
    end: blank.index + blank[0].length,
  }));
  const ids = new Map<number, string | null>();
  return (at) => {
    // The first blank line ending after `at` closes the block; the one before it opened it.
    let low = 0;
    let high = blanks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((blanks[middle] as { end: number }).end <= at) low = middle + 1;
      else high = middle;
    }
    const opening = blanks[low - 1];
    const start = opening === undefined ? 0 : opening.end;
    if (!ids.has(start)) {
      const closing = blanks[low];
      const end = closing === undefined ? text.length : closing.start;
      ids.set(start, blockIdAtEnd(text.slice(start, end).trimEnd())?.id ?? null);
    }
    return ids.get(start) ?? null;
  };
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
    [CORRECTIONS_DIGEST_KEY]: correction.digest,
    [CORRECTIONS_ORIGINAL_DIGEST_KEY]: correction.originalDigest,
  };
}

/** What the frontmatter is changed by when a meeting was read and held nothing to correct. */
export const NOTHING_CORRECTED_PROPERTIES: Readonly<Record<string, unknown>> = {
  [CORRECTIONS_KEY]: CORRECTIONS_NONE,
};

/** What the frontmatter is changed by once the corrections are undone. */
export const UNDONE_CORRECTION_PROPERTIES: Readonly<Record<string, unknown>> = {
  [CORRECTIONS_KEY]: CORRECTIONS_UNDONE,
  [CORRECTIONS_DIGEST_KEY]: null,
  [CORRECTIONS_ORIGINAL_DIGEST_KEY]: null,
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
 * edit. A change to the frontmatter alone does not stop it, and nor does
 * Claude's summary block (#185): the record is of the body without it, so a
 * block written, rewritten or taken out since stays as it is.
 *
 * A record from a build that took the block in is still read: when the body
 * without its block is not the one recorded, the whole body is tried.
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
  const recorded = properties[CORRECTIONS_DIGEST_KEY];
  const apart = apartFromSummary(body);
  const read: BodyApart =
    recorded === correctionDigestOf(apart.text) ? apart : { text: body, block: null };
  if (recorded !== correctionDigestOf(read.text)) {
    return refused(
      'The meeting changed since its words were corrected, so they were left as they are.',
    );
  }
  const spots = records
    .flatMap(({ from, to, at }) => at.map((start) => ({ start, from, to })))
    .sort((left, right) => left.start - right.start);
  const restored = undoneSpots(read.text, spots);
  // The change list is as editable as the frontmatter it is in: only the original's own digest vouches for it.
  if (
    restored === null ||
    properties[CORRECTIONS_ORIGINAL_DIGEST_KEY] !== correctionDigestOf(restored)
  ) {
    return refused(
      'The corrections recorded on this meeting do not match its words, so nothing was undone.',
    );
  }
  const edits = spots.map(({ start, from, to }) => ({ start, grew: from.length - to.length }));
  return { ok: true, body: withBlockBack(restored, read.block, edits) };
}

/** `text` with each spot's spelling put back as it was heard; null when one is not in it. */
function undoneSpots(
  text: string,
  spots: readonly { readonly start: number; readonly from: string; readonly to: string }[],
): string | null {
  let original = '';
  let read = 0;
  for (const { start, from, to } of spots) {
    if (start < read || text.slice(start, start + to.length) !== to) return null;
    original += text.slice(read, start) + from;
    read = start + to.length;
  }
  return original + text.slice(read);
}

const refused = (reason: string): CorrectionUndo => ({ ok: false, reason });
