import { MeetingMappingError, oneLine } from './meeting-mapping-error.ts';

/**
 * Lines the providers add that are about the provider, not the meeting
 * (ADR-0027: boilerplate never reaches the file).
 */
const BOILERPLATE = [
  /^chat with meeting transcript\b/i,
  /^you should review gemini'?s notes/i,
  /^get tips and learn how gemini takes notes/i,
  /^please provide feedback about using gemini/i,
  /^how is the quality of these specific notes\?/i,
  /^this editable transcript was computer generated/i,
];

/** A fence opener: three or more of one character; a backtick fence's info has no backtick. */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** A heading, at any level, that names a contract section: only `## Name` may, as the section. */
const SECTION_NAME =
  /^ {0,3}#{1,6}[ \t]+(summary|notes|provider next steps|transcript)(?:[ \t]+#+)?(?:[ \t]+\^[A-Za-z0-9-]+)?[ \t]*$/i;
/** `#` and `##` (even bare, an empty heading) would open a section of their own; the contract has only four. */
const TOP_HEADING = /^ {0,3}#{1,2}(?=[ \t]|$)/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** A trailing `^id`: a block id, which only Transcript turns may carry (`^t0001`…). */
const TRAILING_ID = /(^|\s)\^([A-Za-z0-9-]+)(\s*)$/;

/** The line with a trailing `^id` escaped, so the provider's text never claims a block id. */
const withoutBlockId = (line: string) => line.replace(TRAILING_ID, '$1\\^$2$3');

export const isBoilerplate = (line: string): boolean =>
  BOILERPLATE.some((pattern) => pattern.test(line.trim()));

/** Lines of text from a string or a list of strings; none for nothing. */
export function textLines(value: unknown, field: string): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').split('\n');
  if (Array.isArray(value)) return value.flatMap((each) => textLines(oneLine(each), field));
  throw new MeetingMappingError(`${field}: expected text, got ${typeof value}`);
}

/** The lines with leading and trailing blank lines and rules taken off. */
function trimmed(lines: readonly string[]): string[] {
  const isEdge = (line: string) => line.trim() === '' || RULE.test(line);
  let first = 0;
  let last = lines.length;
  while (first < last && isEdge(lines[first] ?? '')) first += 1;
  while (last > first && isEdge(lines[last - 1] ?? '')) last -= 1;
  return lines.slice(first, last);
}

/** A line, and whether it is code: a fence line, or inside a fence. */
export interface FencedLine {
  readonly text: string;
  readonly code: boolean;
}

/**
 * The lines, each marked code or not, and the marker of a fence left open at
 * the end (```` ``` ````, `~~~~`…), else null. A fence closes as CommonMark
 * closes it: the same character, at least as many.
 */
export function fencedLines(lines: readonly string[]): {
  lines: FencedLine[];
  open: string | null;
} {
  const marked: FencedLine[] = [];
  let fence: string | null = null;
  for (const text of lines) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(text)?.[1];
      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) {
        fence = null;
      }
      marked.push({ text, code: true });
      continue;
    }
    fence = FENCE_OPEN.exec(text)?.[1] ?? null;
    marked.push({ text, code: fence !== null });
  }
  return { lines: marked, open: fence };
}

/**
 * A provider's prose as a section's markdown: boilerplate dropped, `#`/`##`
 * headings made `###` (so they stay inside the section), and a code fence the
 * provider left open closed, so it cannot swallow the sections after it.
 */
export function sectionText(value: unknown, field: string): string {
  const prose = textLines(value, field).filter((line) => !isBoilerplate(line));
  const { lines, open } = fencedLines(prose);
  const written = lines.map(({ text, code }) => (code ? text : proseLine(text)));
  if (open !== null) written.push(open);
  return trimmed(written).join('\n');
}

/**
 * A line outside code: a heading naming a section becomes bold text, other
 * `#`/`##` headings `###`, and a trailing `^id` is escaped.
 */
function proseLine(line: string): string {
  const named = SECTION_NAME.exec(line);
  if (named !== null) return `**${named[1]}**`;
  return withoutBlockId(line.replace(TOP_HEADING, '###'));
}

/** A next step as a provider may hand it over as a record. */
interface StepRecord {
  readonly owner?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly text?: unknown;
  readonly confidence?: unknown;
}

const CONFIDENCE = /^(high|medium|low)$/i;
const ITEM_START = /^\s*(?:[-*+]|\d+[.)])\s+/;
/** `[Owner] rest`; `[ ]`/`[x]` are checkboxes, not owners. */
const OWNER = /^\[([^\]\n]*)\]\s+(.*)$/;
/** A plain line opening with `[Owner] ` (Notion's `\[Owner\]` too) starts a step of its own. */
const OWNER_START = /^\s*\\?\[[^\]\n]*\\?\]\s+/;

/** The owner with each bracket that pairs with none taken out, so its `[…]` closes where it ends. */
function balanced(owner: string): string {
  const unpaired = new Set<number>();
  const open: number[] = [];
  [...owner].forEach((each, at) => {
    if (each === '[') open.push(at);
    else if (each === ']' && open.pop() === undefined) unpaired.add(at);
  });
  for (const at of open) unpaired.add(at);
  return [...owner]
    .filter((_, at) => !unpaired.has(at))
    .join('')
    .trim();
}

function stepLine(rawOwner: string, text: string, confidence: string): string | null {
  const words = oneLine(text);
  if (words === '') return null;
  const owner = balanced(rawOwner);
  const named = owner !== '' && !/^x?$/i.test(owner) ? `[${owner}] ` : '';
  // With no owner, a `[` opening the words would be read as one (or as a checkbox).
  const unowned = named === '' ? words.replace(/^\[/, '\\[') : words;
  const sure = CONFIDENCE.test(confidence) ? ` (confidence: ${confidence.toLowerCase()})` : '';
  return withoutBlockId(`- ${named}${unowned}${sure}`);
}

function fromRecord(record: StepRecord): string | null {
  const title = oneLine(record.title);
  const description = oneLine(record.description ?? record.text);
  const text = title && description ? `${title}: ${description}` : title || description;
  return stepLine(oneLine(record.owner), text, oneLine(record.confidence));
}

function fromItem(item: string): string | null {
  const text = oneLine(item.replace(/\\([[\]])/g, '$1'));
  const owned = OWNER.exec(text);
  return owned === null ? stepLine('', text, '') : stepLine(oneLine(owned[1]), owned[2] ?? '', '');
}

/**
 * Items from lines: a bullet, a number or an `[Owner]` starts one; any other
 * line continues the one before.
 */
function items(lines: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' || RULE.test(line) || isBoilerplate(line)) continue;
    const last = found.length - 1;
    const starts = ITEM_START.test(line) || OWNER_START.test(line);
    if (starts || last < 0) found.push(line.replace(ITEM_START, ''));
    else found[last] = `${found[last]} ${line.trim()}`;
  }
  return found;
}

/**
 * The Provider next steps section: one `- [Owner] Title: description` line
 * per step, from Gemini's lines (Notion's `\[Owner\]` escapes undone), from
 * Granola's items with indented descriptions, or from records with an owner,
 * title, description and confidence.
 */
export function nextStepsText(value: unknown): string {
  const records = Array.isArray(value)
    ? value.filter((each): each is StepRecord => typeof each === 'object' && each !== null)
    : [];
  const steps =
    records.length > 0
      ? records.map(fromRecord)
      : items(textLines(value, 'nextSteps')).map(fromItem);
  return steps.filter((step): step is string => step !== null).join('\n');
}
