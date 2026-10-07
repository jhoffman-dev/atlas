import { bodyError, type MeetingImportError } from './meeting-import-error.ts';
import { numberedLines, readFences, withoutBlockId, type NumberedLine } from './meeting-lines.ts';

export type MeetingSectionName = 'summary' | 'notes' | 'nextSteps' | 'transcript';

/** The body's sections in the order meeting/v1 writes them, by heading. */
const SECTIONS: ReadonlyArray<readonly [heading: string, name: MeetingSectionName]> = [
  ['Summary', 'summary'],
  ['Notes', 'notes'],
  ['Provider next steps', 'nextSteps'],
  ['Transcript', 'transcript'],
];

/** One `## Heading` section of a meeting's body and the text under it. */
export interface MeetingSection {
  readonly name: MeetingSectionName;
  /** The text under the heading, every byte as written, up to the next section. */
  readonly text: string;
  /** The file line the heading is on. */
  readonly headingLine: number;
}

/** An ATX heading: its `#`s and the rest of the line. Linear: no pattern backtracks. */
const ATX = /^ {0,3}(#{1,6})(?:[ \t](.*))?$/;
const SECTION_LIST = SECTIONS.map(([heading]) => heading).join(', ');

function sectionNamed(heading: string): number {
  return SECTIONS.findIndex(([known]) => known.toLowerCase() === heading.toLowerCase());
}

/**
 * A heading's words: without a closing run of `#`s (`## Summary ##`) or the
 * block id a citation gives it (`## Transcript ^h2k8d1`, ADR-0022).
 */
function headingWords(written: string): string {
  const text = written.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  const closes = end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t';
  const open = end < text.length && closes ? text.slice(0, end) : text;
  return withoutBlockId(open.trimEnd()).rest.trim();
}

interface Heading extends NumberedLine {
  readonly level: number;
  readonly heading: string;
}

/** The headings of a body that are not inside fenced code, and the fence left open, if any. */
function headingLines(lines: readonly NumberedLine[]): {
  readonly headings: readonly Heading[];
  readonly unclosed: NumberedLine | null;
} {
  const { fenced, unclosed } = readFences(lines);
  const headings: Heading[] = [];
  lines.forEach((each, index) => {
    const match = fenced[index] === true ? null : ATX.exec(each.text);
    if (match === null) return;
    headings.push({ ...each, level: match[1]?.length ?? 0, heading: headingWords(match[2] ?? '') });
  });
  return { headings, unclosed };
}

/**
 * An error for every heading that names a section at another level: a
 * `# Transcript` would otherwise leave the meeting silently without its turns.
 */
function levelErrors(headings: readonly Heading[]): MeetingImportError[] {
  return headings
    .filter(({ level, heading }) => level !== 2 && sectionNamed(heading) !== -1)
    .map(({ level, heading, line }) => {
      const message = `${'#'.repeat(level)} ${heading} must be written \`## ${heading}\``;
      return bodyError(heading, message, line);
    });
}

/** The error for a fence never closed, which would hide every section after it. */
function unclosedError(unclosed: NumberedLine, headings: readonly Heading[]): MeetingImportError {
  const within = headings.filter((each) => each.level === 2 && each.line < unclosed.line).at(-1);
  const message = `Line ${unclosed.line} opens a code fence that is never closed, which hides the rest of the file`;
  return bodyError(within?.heading ?? 'body', message, unclosed.line);
}

/** Why a heading cannot open a section here, given the last section read; or null. */
function headingProblem(index: number, previous: number, heading: string): string | null {
  if (index === -1) return `## ${heading} is not a meeting/v1 section (${SECTION_LIST})`;
  if (index === previous) return `## ${heading} appears twice`;
  if (index < previous) return `## ${heading} is out of order: sections go ${SECTION_LIST}`;
  return null;
}

const byLine = (a: MeetingImportError, b: MeetingImportError) => (a.line ?? 0) - (b.line ?? 0);

/**
 * A meeting body's sections, and every heading that breaks the contract: one
 * it does not name, one written twice, one out of order, or a section named
 * at another level than `##`. A code fence left open is refused, since it
 * would swallow the sections after it. Text before the first section — a
 * `# Title`, say — belongs to no section and is left alone.
 */
export function splitMeetingSections(
  body: string,
  firstLine: number,
): {
  readonly sections: readonly MeetingSection[];
  readonly errors: readonly MeetingImportError[];
} {
  const lines = body.split('\n');
  const read = headingLines(numberedLines(body, firstLine));
  const headings = read.headings.filter((each) => each.level === 2);
  const sections: MeetingSection[] = [];
  const errors: MeetingImportError[] = levelErrors(read.headings);
  if (read.unclosed !== null) errors.push(unclosedError(read.unclosed, read.headings));
  let previous = -1;
  headings.forEach(({ heading, line }, at) => {
    const index = sectionNamed(heading);
    const problem = headingProblem(index, previous, heading);
    const known = SECTIONS[index];
    if (problem !== null || known === undefined) {
      errors.push(bodyError(heading, problem ?? heading, line));
      return;
    }
    const end = (headings[at + 1]?.line ?? firstLine + lines.length) - firstLine;
    const text = lines.slice(line - firstLine + 1, end).join('\n');
    sections.push({ name: known[1], text, headingLine: line });
    previous = index;
  });
  return { sections, errors: errors.sort(byLine) };
}
