/**
 * The summary Claude writes at the top of a meeting (ADR-0036, "The summary
 * block"): one grammar, one placement rule, and no way to write over the
 * person's words.
 *
 * The block is text before the first section — never a `##` heading, which
 * the meeting's section reader refuses — between two comment markers, as a
 * callout:
 *
 * ```markdown
 * <!-- atlas:summary v1 -->
 *
 * > [!summary] Summary by Claude (claude-sonnet-5-5, 2026-10-14)
 * > Larkspur Payroll and the platform team agreed to ship the cache behind a flag.
 * >
 * > **Action items**
 * >
 * > - Flag the cache before Friday: Tobias Fenn (turn t0002)
 *
 * <!-- /atlas:summary -->
 * ```
 *
 * Plain bullets only: a `- [ ]` would be read as the person's own to-do, and a
 * `[[link]]` is rewritten by renames and archives (ADR-0003, ADR-0004), so the
 * block holds neither. A turn is named by its id as text; the tasks are reached
 * through the meeting's `tasks`.
 *
 * The block is replaced only between its own markers, and only while its
 * digest is the one recorded when it was written: an edited block, a missing
 * closing marker, two blocks, a marker version this code does not know, or a
 * block inside a code fence is refused, and nothing is written.
 */

import { digestOf } from '../sources/merge.ts';
import type { PropertyDef } from '../types/property-def.ts';
import { numberedLines, readFences } from './meeting-lines.ts';

/** The marker that opens the block, version and all. */
export const SUMMARY_OPEN_MARKER = '<!-- atlas:summary v1 -->';
/** The marker that closes it, on its own line after the callout. */
export const SUMMARY_CLOSE_MARKER = '<!-- /atlas:summary -->';

/** The digest of the block as written: how an edit to it is told (ADR-0036). */
export const SUMMARY_DIGEST_KEY = 'atlas_summary_digest';
/** The digest of the transcript it summarised: how unchanged words are skipped. */
export const SUMMARY_OF_KEY = 'atlas_summary_of';
/** The model that wrote it. */
export const SUMMARY_MODEL_KEY = 'atlas_summary_model';

const textProperty = (key: string, label: string): PropertyDef => ({
  key,
  kind: 'text',
  label,
  required: false,
  options: [],
  target: null,
  many: false,
});

/**
 * The summary's keys as the Meeting type declares them (#185), so the
 * properties panel names them and a query can: a vault's Meeting type gains
 * them on opening, as it gains the import's (#162).
 */
export const MEETING_SUMMARY_PROPERTIES: readonly PropertyDef[] = [
  textProperty(SUMMARY_DIGEST_KEY, 'Summary digest'),
  textProperty(SUMMARY_OF_KEY, 'Summary of'),
  textProperty(SUMMARY_MODEL_KEY, 'Summary model'),
];

/** The longest the summary's own paragraph runs, in words. */
export const MAX_SUMMARY_WORDS = 150;
/** The most key points the block lists. */
export const MAX_KEY_POINTS = 6;
/** The most open questions the block lists. */
export const MAX_OPEN_QUESTIONS = 4;
/** About the most the whole block takes: a glance, not a document. */
export const MAX_SUMMARY_BLOCK_CHARACTERS = 1500;
/** The longest one bullet runs: a line, not a paragraph. */
const MAX_LINE_CHARACTERS = 200;
/** The longest the paragraph runs whatever its words: one word can be a megabyte. */
const MAX_SUMMARY_CHARACTERS = 1000;

/** One action item as the block lists it. */
export interface SummaryActionItem {
  readonly title: string;
  /** Who took it on, as the vault spells them; `you` for the owner; blank when nobody was named. */
  readonly assignee: string;
  /** The transcript turn it came from, as an id (`t0002`); null when it names none. */
  readonly turn: string | null;
  /** Whether a task stands for it: one made now, or before. */
  readonly taskMade: boolean;
}

/** What the block says. */
export interface MeetingSummary {
  readonly model: string;
  /** `YYYY-MM-DD`: when it was written. */
  readonly date: string;
  /** The paragraph: what the meeting was for and what came of it. Blank when the answer's did not read. */
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly decisions: readonly string[];
  readonly actionItems: readonly SummaryActionItem[];
  readonly openQuestions: readonly string[];
}

/** The block as written, and what was cut to fit, for the log. */
export interface RenderedSummary {
  /** From the opening marker to the closing one, lines ended by `\n`, no line end after the last. */
  readonly text: string;
  readonly cut: readonly string[];
}

/** Why a block is not one to write over. */
export type SummaryRefusal =
  | 'edited'
  | 'removed'
  | 'unclosed'
  | 'stray-marker'
  | 'two-blocks'
  | 'unknown-version'
  | 'in-code-fence';

const REFUSAL_WORDS: Readonly<Record<SummaryRefusal, string>> = {
  edited: 'The summary at the top was edited since Claude wrote it, so it was left as it is.',
  removed: 'The summary Claude wrote was taken out of the meeting, so it was not put back.',
  unclosed: 'The summary at the top has no closing marker, so it was left as it is.',
  'stray-marker':
    'The meeting has a summary closing marker with no opening one, so nothing was written.',
  'two-blocks': 'The meeting has more than one summary block, so neither was written over.',
  'unknown-version':
    'The summary at the top was written by another version of Atlas, so it was left as it is.',
  'in-code-fence': 'A summary marker sits inside a code fence, so nothing was written.',
};

/** What a meeting's body holds of a summary block. */
export type SummaryBlockReading =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'block';
      /** Every byte from the opening marker to the end of the closing one. */
      readonly text: string;
      readonly start: number;
      readonly end: number;
      readonly digest: string;
      /** The model and date its callout's title names; null when the title does not read. */
      readonly model: string | null;
      readonly date: string | null;
    }
  | { readonly kind: 'refused'; readonly refusal: SummaryRefusal; readonly reason: string };

/** Where the block goes, or why it may not. */
export type SummaryPlacement =
  | {
      readonly ok: true;
      readonly body: string;
      /** The digest of the block as written into `body`: `atlas_summary_digest`. */
      readonly digest: string;
      /** Whether a block was there and was replaced. */
      readonly replaced: boolean;
      /** The block replaced, as it was; null when none was there. */
      readonly prior: string | null;
    }
  | { readonly ok: false; readonly refusal: SummaryRefusal; readonly reason: string };

/** Whether the meeting's summary is Claude's as written, edited by the person, or not there. */
export type SummaryWritten = 'written' | 'edited' | 'none';

/** The digest a block is known by: of its own bytes, markers included, and nothing outside them. */
export function summaryBlockDigest(block: string): string {
  return digestOf(block);
}

/**
 * The block for `summary`, held to the sizes a glance allows: the paragraph
 * to {@link MAX_SUMMARY_WORDS} words, {@link MAX_KEY_POINTS} key points and
 * {@link MAX_OPEN_QUESTIONS} open questions, and the whole to about
 * {@link MAX_SUMMARY_BLOCK_CHARACTERS} characters. Whatever was cut is said
 * in `cut`. Every line of the model's is made plain first: one line, no
 * marker, no link, no checkbox, nothing that could close the callout.
 */
export function renderSummaryBlock(summary: MeetingSummary): RenderedSummary {
  const cut: string[] = [];
  let shown = plainSummary(summary, cut);
  let text = blockText(shown);
  const before = text.length;
  const dropped = new Map<Trimmed, number>();
  while (text.length > MAX_SUMMARY_BLOCK_CHARACTERS) {
    const smaller = smallerByOne(shown);
    if (smaller === null) break;
    dropped.set(smaller.dropped, (dropped.get(smaller.dropped) ?? 0) + 1);
    shown = smaller.shown;
    text = blockText(shown);
  }
  if (dropped.size > 0) {
    const what = [...dropped].map(([kind, count]) => TRIMMED_WORDS[kind](count)).join(', ');
    cut.push(
      `The block was ${before} characters, more than about ${MAX_SUMMARY_BLOCK_CHARACTERS}: left out ${what}.`,
    );
  }
  return { text, cut };
}

/** What the block shows once trimmed: the items left out are counted, not listed. */
interface ShownSummary {
  readonly title: string;
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly decisions: readonly string[];
  readonly actionItems: readonly string[];
  /** Action items listed in the meeting but not in the block. */
  readonly moreItems: number;
  readonly openQuestions: readonly string[];
}

function plainSummary(summary: MeetingSummary, cut: string[]): ShownSummary {
  const words = plainLine(summary.summary, Number.MAX_SAFE_INTEGER).split(' ').filter(Boolean);
  if (words.length > MAX_SUMMARY_WORDS) {
    cut.push(`The summary was ${words.length} words: cut to ${MAX_SUMMARY_WORDS}.`);
  }
  const keyPoints = plainLines(summary.keyPoints);
  if (keyPoints.length > MAX_KEY_POINTS) {
    cut.push(`There were ${keyPoints.length} key points: kept the first ${MAX_KEY_POINTS}.`);
  }
  const openQuestions = plainLines(summary.openQuestions);
  if (openQuestions.length > MAX_OPEN_QUESTIONS) {
    cut.push(
      `There were ${openQuestions.length} open questions: kept the first ${MAX_OPEN_QUESTIONS}.`,
    );
  }
  return {
    title: `Summary by Claude (${plainModel(summary.model)}, ${plainDate(summary.date)})`,
    summary: plainLine(
      words.length > MAX_SUMMARY_WORDS
        ? `${words.slice(0, MAX_SUMMARY_WORDS).join(' ')}…`
        : words.join(' '),
      MAX_SUMMARY_CHARACTERS,
    ),
    keyPoints: keyPoints.slice(0, MAX_KEY_POINTS),
    decisions: plainLines(summary.decisions),
    actionItems: summary.actionItems.flatMap((item) => {
      const line = actionItemLine(item);
      return line === '' ? [] : [line];
    }),
    moreItems: 0,
    openQuestions: openQuestions.slice(0, MAX_OPEN_QUESTIONS),
  };
}

/** `Send the contract: you (a task was made)`; `Flag the cache: Tobias Fenn (turn t0002)`. */
function actionItemLine({ title, assignee, turn, taskMade }: SummaryActionItem): string {
  const what = plainLine(title, MAX_LINE_CHARACTERS);
  if (what === '') return '';
  const who = plainLine(assignee, 120) || 'nobody named';
  const turnId = turn === null ? '' : plainLine(turn, 40).replace(/[^A-Za-z0-9-]/g, '');
  const note = taskMade ? 'a task was made' : turnId === '' ? '' : `turn ${turnId}`;
  return note === '' ? `${what}: ${who}` : `${what}: ${who} (${note})`;
}

/** What is left out first when the block is too long. */
type Trimmed = 'question' | 'item' | 'decision' | 'point' | 'words';

const TRIMMED_WORDS: Readonly<Record<Trimmed, (count: number) => string>> = {
  question: (count) => (count === 1 ? '1 open question' : `${count} open questions`),
  item: (count) => (count === 1 ? '1 action item' : `${count} action items`),
  decision: (count) => (count === 1 ? '1 decision' : `${count} decisions`),
  point: (count) => (count === 1 ? '1 key point' : `${count} key points`),
  words: (count) => `${count * 20} words of the summary`,
};

/**
 * One fewer line than `shown`, the least useful first: an open question, then
 * an action item past the third (counted as "and N more"), a decision past
 * the second, a key point past the second, and last twenty words of the
 * paragraph. Null when nothing more can go.
 */
function smallerByOne(shown: ShownSummary): { shown: ShownSummary; dropped: Trimmed } | null {
  if (shown.openQuestions.length > 0) {
    return {
      shown: { ...shown, openQuestions: shown.openQuestions.slice(0, -1) },
      dropped: 'question',
    };
  }
  if (shown.actionItems.length > 3) {
    const actionItems = shown.actionItems.slice(0, -1);
    return { shown: { ...shown, actionItems, moreItems: shown.moreItems + 1 }, dropped: 'item' };
  }
  if (shown.decisions.length > 2) {
    return { shown: { ...shown, decisions: shown.decisions.slice(0, -1) }, dropped: 'decision' };
  }
  if (shown.keyPoints.length > 2) {
    return { shown: { ...shown, keyPoints: shown.keyPoints.slice(0, -1) }, dropped: 'point' };
  }
  const words = shown.summary.replace(/…$/, '').split(' ');
  if (words.length <= 20) return null;
  return { shown: { ...shown, summary: `${words.slice(0, -20).join(' ')}…` }, dropped: 'words' };
}

/** The block's lines, markers and callout, ended by `\n` with none after the last. */
function blockText(shown: ShownSummary): string {
  const section = (heading: string, lines: readonly string[]): string[] =>
    lines.length === 0 ? [] : ['', `**${heading}**`, '', ...lines.map((line) => `- ${line}`)];
  const more =
    shown.moreItems === 0
      ? []
      : [`- and ${shown.moreItems} more: see the meeting’s tasks and the Inbox`];
  const items = section('Action items', shown.actionItems);
  const quoted = [
    `[!summary] ${shown.title}`,
    ...(shown.summary === '' ? [] : [shown.summary]),
    ...section('Key points', shown.keyPoints),
    ...section('Decisions', shown.decisions),
    ...(items.length === 0 && more.length === 0 ? [] : [...items, ...more]),
    ...section('Open questions', shown.openQuestions),
  ];
  // The closing marker stands outside the callout: inside it, the editor reads the callout as code.
  return [
    SUMMARY_OPEN_MARKER,
    '',
    ...quoted.map((line) => (line === '' ? '>' : `> ${line}`)),
    '',
    SUMMARY_CLOSE_MARKER,
  ].join('\n');
}

function plainLines(lines: readonly string[]): string[] {
  return lines.map((line) => plainLine(line, MAX_LINE_CHARACTERS)).filter((line) => line !== '');
}

const WIKI_LINK = /!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;
const COMMENT_MARK = /<!--|-->/g;
const LEADING_LIST_MARK = /^(?:[-*+]|\d{1,9}[.)])\s+/;
const LEADING_CHECKBOX = /^\[[ xX]?\]\s*/;
const LEADING_QUOTE = /^(?:>\s*)+/;
const LEADING_HEADING = /^#{1,6}\s+/;
const HASH_TAG = /(^|\s)#+(?=[^\s#])/g;
const TRAILING_BLOCK_ID = /\s\^[A-Za-z0-9-]+$/;

/**
 * A model's text as one plain line of the block: on one line, so nothing it
 * holds can end the callout; with no comment marker, so it cannot close or
 * open a block; a wikilink as its words, a tag as its word; no list mark,
 * checkbox, quote or heading of its own; no block id at its end; and cut to
 * `max` characters.
 */
export function plainLine(text: string, max: number): string {
  const line = withoutCommentMarks(text)
    .replace(WIKI_LINK, (_whole, target: string, alias: string | undefined) =>
      linkWords(target, alias),
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_QUOTE, '')
    .replace(LEADING_HEADING, '')
    .replace(LEADING_LIST_MARK, '')
    .replace(LEADING_CHECKBOX, '')
    .replace(HASH_TAG, '$1')
    .replace(TRAILING_BLOCK_ID, '')
    .trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** `text` with no comment mark left, however they nest: taking one out can join two halves into another. */
function withoutCommentMarks(text: string): string {
  let plain = text;
  for (let was = ''; was !== plain;) {
    was = plain;
    plain = plain.replace(COMMENT_MARK, '');
  }
  return plain;
}

/** A wikilink as the words it shows: its alias, else its note's title. */
function linkWords(target: string, alias: string | undefined): string {
  if (alias !== undefined && alias.trim() !== '') return alias.trim();
  const note = target.split('#')[0] ?? '';
  return note.slice(note.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

/** A model's name as a title holds it: letters, digits and the marks model names use. */
function plainModel(model: string): string {
  const plain = model.replace(/[^A-Za-z0-9._:/-]/g, '').slice(0, 80);
  return plain === '' ? 'Claude' : plain;
}

function plainDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

const OPEN_LINE = /^<!--\s*atlas:summary\b(.*)-->$/;
const KNOWN_OPEN = /^<!-- atlas:summary v1 -->$/;
const CLOSE_LINE = /^(?:>\s*)*<!--\s*\/atlas:summary\s*-->$/;
const TITLE_LINE = /^>\s*\[!summary\][^(]*\(([^,()]*),\s*(\d{4}-\d{2}-\d{2})\)\s*$/;

/** One line of a body with where it sits: its text without the line break, and its offsets. */
interface BodyLine {
  readonly text: string;
  readonly start: number;
  /** Where its text ends, before any line break. */
  readonly end: number;
  /** Where the next line starts. */
  readonly next: number;
  readonly fenced: boolean;
}

function bodyLines(body: string): BodyLine[] {
  const numbered = numberedLines(body, 1);
  const { fenced } = readFences(numbered);
  const lines: BodyLine[] = [];
  let start = 0;
  for (const [index, each] of numbered.entries()) {
    const breakAt = body.indexOf('\n', start);
    const next = breakAt === -1 ? body.length : breakAt + 1;
    lines.push({
      text: each.text,
      start,
      end: start + each.text.length,
      next,
      fenced: fenced[index] === true,
    });
    start = next;
  }
  return lines;
}

const refusedAs = (refusal: SummaryRefusal) =>
  ({ kind: 'refused', refusal, reason: REFUSAL_WORDS[refusal] }) as const;

/**
 * What `body` holds of a summary block: none, one well-formed block (with
 * its digest, and the model and date its title names), or why it cannot be
 * read as one — a marker inside fenced code, a version unknown here, two
 * blocks, an opening marker never closed, or a closing one never opened.
 */
export function readSummaryBlock(body: string): SummaryBlockReading {
  const lines = bodyLines(body);
  const marked = lines.filter(({ text }) => isOpenLine(text) || CLOSE_LINE.test(text.trim()));
  if (marked.length === 0) return { kind: 'none' };
  if (marked.some(({ fenced }) => fenced)) return refusedAs('in-code-fence');
  const opens = marked.filter(({ text }) => isOpenLine(text));
  const closes = marked.filter(({ text }) => !isOpenLine(text));
  if (opens.some(({ text }) => !KNOWN_OPEN.test(text.trim()))) return refusedAs('unknown-version');
  if (opens.length > 1) return refusedAs('two-blocks');
  const [open] = opens;
  if (open === undefined) return refusedAs('stray-marker');
  const [close, ...more] = closes;
  if (close === undefined) return refusedAs('unclosed');
  if (close.start < open.start || more.length > 0) return refusedAs('stray-marker');
  const text = body.slice(open.start, close.end);
  const title = lines.find(
    (line) => line.start > open.start && line.start < close.start && TITLE_LINE.test(line.text),
  );
  const named = title === undefined ? null : TITLE_LINE.exec(title.text);
  return {
    kind: 'block',
    text,
    start: open.start,
    end: close.end,
    digest: summaryBlockDigest(text),
    model: named?.[1]?.trim() || null,
    date: named?.[2] ?? null,
  };
}

const isOpenLine = (text: string): boolean => OPEN_LINE.test(text.trim());

/**
 * `body` with `block` at the top: replacing the block there, between its own
 * markers, when its digest is `recorded` (the one written with it); placed
 * after a leading `# Title` line, else before the first `##` section, else at
 * the start of the body, when there is none and none was ever recorded. Every
 * byte outside the block is kept. A body written with Windows line ends gets
 * the block with them too.
 *
 * Refused, with nothing written, when the block there is not the one
 * recorded (`edited`), was taken out since it was written (`removed`), or
 * cannot be read as one block ({@link readSummaryBlock}).
 */
export function placeSummary(
  body: string,
  block: string,
  { recorded }: { recorded: string | null },
): SummaryPlacement {
  const reading = readSummaryBlock(body);
  if (reading.kind === 'refused') return { ok: false, ...withoutKind(reading) };
  const written = withLineEnds(block, lineEndOf(body));
  const digest = summaryBlockDigest(written);
  if (reading.kind === 'block') {
    if (recorded === null || reading.digest !== recorded) return refusal('edited');
    return {
      ok: true,
      body: body.slice(0, reading.start) + written + body.slice(reading.end),
      digest,
      replaced: true,
      prior: reading.text,
    };
  }
  if (recorded !== null) return refusal('removed');
  return { ok: true, body: insertedAtTop(body, written), digest, replaced: false, prior: null };
}

/**
 * `body` without the block, when it is the one recorded: what undoing the run
 * that wrote it does. The blank line written after it goes with it. Refused
 * as {@link placeSummary} is, and when there is no block to take out.
 */
export function removeSummary(
  body: string,
  { recorded }: { recorded: string },
): { readonly ok: true; readonly body: string } | Extract<SummaryPlacement, { ok: false }> {
  const reading = readSummaryBlock(body);
  if (reading.kind === 'refused') return { ok: false, ...withoutKind(reading) };
  if (reading.kind === 'none') return refusal('removed');
  if (reading.digest !== recorded) return refusal('edited');
  const { start, end } = blockSpan(body, reading);
  return { ok: true, body: body.slice(0, start) + body.slice(end) };
}

/**
 * `body` with the summary it holds — while it is the one recorded — put back
 * to `prior`, the block it was written over: what undoing a run that
 * replaced a summary does. Refused as {@link removeSummary} is, and when
 * `prior` is not one summary block, every byte of it (a run log is a note
 * anyone can write into).
 */
export function restoreSummary(
  body: string,
  { recorded, prior }: { recorded: string; prior: string },
):
  | { readonly ok: true; readonly body: string; readonly digest: string }
  | { readonly ok: false; readonly reason: string } {
  const reading = readSummaryBlock(body);
  if (reading.kind === 'refused') return { ok: false, reason: reading.reason };
  if (reading.kind === 'none') return refusal('removed');
  if (reading.digest !== recorded) return refusal('edited');
  const earlier = readSummaryBlock(prior);
  if (earlier.kind !== 'block' || earlier.text !== prior) {
    return { ok: false, reason: PRIOR_UNREADABLE };
  }
  return {
    ok: true,
    body: body.slice(0, reading.start) + prior + body.slice(reading.end),
    digest: earlier.digest,
  };
}

const PRIOR_UNREADABLE =
  'The summary this run wrote over is not one Atlas can put back, so the summary was left as it is.';

/**
 * `text` without its summary block, what the model is shown: it never
 * summarises its own summary. A block that cannot be read as one is left in.
 */
export function withoutSummaryBlock(text: string): string {
  const span = summaryBlockSpan(text);
  return span === null ? text : text.slice(0, span.start) + text.slice(span.end);
}

/**
 * Where `text`'s summary block sits, with the blank line written after it:
 * what {@link withoutSummaryBlock} takes out. Null when there is no block
 * that reads as one.
 */
export function summaryBlockSpan(text: string): { start: number; end: number } | null {
  const reading = readSummaryBlock(text);
  return reading.kind === 'block' ? blockSpan(text, reading) : null;
}

/** The block's span, the line breaks after it (up to two) included. */
function blockSpan(text: string, block: { start: number; end: number }) {
  const eol = lineEndOf(text);
  let end = block.end;
  for (let breaks = 0; breaks < 2 && text.startsWith(eol, end); breaks += 1) end += eol.length;
  return { start: block.start, end };
}

/**
 * Whether the summary at the top is Claude's as written (its digest is the
 * one recorded), the person's now (edited, broken, or taken out after it was
 * written), or not there.
 */
export function summaryWritten(body: string, recorded: string | null): SummaryWritten {
  const reading = readSummaryBlock(body);
  if (reading.kind === 'refused') return 'edited';
  if (reading.kind === 'block') return recorded === reading.digest ? 'written' : 'edited';
  return recorded === null ? 'none' : 'edited';
}

function refusal(refusal: SummaryRefusal): Extract<SummaryPlacement, { ok: false }> {
  return { ok: false, refusal, reason: REFUSAL_WORDS[refusal] };
}

function withoutKind({ refusal, reason }: Extract<SummaryBlockReading, { kind: 'refused' }>) {
  return { refusal, reason };
}

const lineEndOf = (body: string): string => (body.includes('\r\n') ? '\r\n' : '\n');

const withLineEnds = (block: string, eol: string): string =>
  eol === '\n' ? block : block.replace(/\r?\n/g, eol);

/**
 * `body` with `block` put at its top: after a leading `# Title` line and the
 * blank lines under it, else at the first `##` section, else at the first
 * line with words; a blank line after it. A body with no words gets it at its
 * end, on a line of its own.
 */
function insertedAtTop(body: string, block: string): string {
  const eol = lineEndOf(body);
  const lines = bodyLines(body);
  const at = placeOf(lines);
  if (at === null) {
    const prefix = body.trim() === '' ? '' : body.endsWith('\n') ? eol : eol + eol;
    return `${body}${prefix}${block}${eol}`;
  }
  return body.slice(0, at) + block + eol + eol + body.slice(at);
}

const H1 = /^ {0,3}#[ \t]+\S/;
const H2 = /^ {0,3}##(?:[ \t]|$)/;

/** Where in the body the block starts; null for the end. */
function placeOf(lines: readonly BodyLine[]): number | null {
  const words = (line: BodyLine) => line.text.trim() !== '';
  const firstAt = lines.findIndex(words);
  if (firstAt === -1) return null;
  const first = lines[firstAt]!;
  if (!first.fenced && H1.test(first.text)) {
    const after = lines.slice(firstAt + 1).find(words);
    return after === undefined ? null : after.start;
  }
  const section = lines.find((line) => !line.fenced && H2.test(line.text));
  return (section ?? first).start;
}
