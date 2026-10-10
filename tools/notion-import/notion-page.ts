/**
 * One page of a Notion "Markdown & CSV" export: `# Title`, a paragraph of
 * `Property: value` lines, then the page's own content.
 */
export interface NotionPage {
  readonly title: string;
  readonly properties: ReadonlyMap<string, string>;
  readonly body: string;
  /** The content after the title, the properties paragraph included: the body, should that paragraph prove not to be properties. */
  readonly withProperties: string;
}

const TITLE = /^#\s+(.*)$/;
const PROPERTY = /^([^:\n]{1,100}):\s?(.*)$/;

/** Lines from `at` on, past any blank ones. */
function skipBlank(lines: readonly string[], at: number): number {
  let next = at;
  while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
  return next;
}

/** The page's title, its properties, and the content after them. */
export function readNotionPage(text: string): NotionPage {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n?|\n/);
  let at = skipBlank(lines, 0);
  const title = TITLE.exec(lines[at] ?? '')?.[1]?.trim() ?? '';
  if (title !== '') at = skipBlank(lines, at + 1);
  const withProperties = lines.slice(at).join('\n');
  let end = at;
  while (end < lines.length && PROPERTY.test(lines[end] ?? '')) end += 1;
  const closesParagraph = end > at && (end === lines.length || (lines[end] ?? '').trim() === '');
  const properties = new Map<string, string>();
  if (closesParagraph) {
    for (const line of lines.slice(at, end)) {
      const [, key = '', value = ''] = PROPERTY.exec(line) ?? [];
      properties.set(key.trim(), value.trim());
    }
    at = end;
  }
  return { title, properties, body: lines.slice(at).join('\n'), withProperties };
}

/** The page's content as the meeting mapper's fields read it (tools/n8n/meeting-to-atlas.ts). */
export interface PageSections {
  readonly attendees: string;
  readonly summary: string;
  readonly decisions: string;
  readonly nextSteps: string;
  /** Details, then anything the page holds under a heading of its own, so nothing is dropped. */
  readonly details: string;
  readonly transcript: string;
}

type Field = keyof PageSections;

/** Headings the n8n workflow wrote into each Meeting Notes page, by the field they fill. */
const FIELD_OF: Readonly<Record<string, Field>> = {
  attendees: 'attendees',
  summary: 'summary',
  decisions: 'decisions',
  'next steps': 'nextSteps',
  'action items': 'nextSteps',
  details: 'details',
  notes: 'details',
  transcript: 'transcript',
};

const SECTION_HEADING = /^#{1,2}\s+(.+?)\s*:?\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
/** Where the transcript starts: a `<details>` whose summary is Transcript, or a toggle item. */
const DETAILS_OPEN = /^\s*<details\b[^>]*>/i;
const DETAILS_CLOSE = /<\/details>\s*$/i;
const TRANSCRIPT_SUMMARY = /<summary>\s*(📖\s*)?transcript\s*<\/summary>/i;
const TRANSCRIPT_TOGGLE = /^(\s*)[-*+]\s+(📖\s*)?transcript\s*$/i;

const indentOf = (line: string) => /^\s*/.exec(line)?.[0].length ?? 0;

/** The `<details>` block starting at `at` (nested ones inside it too): its end, exclusive. */
function detailsEnd(lines: readonly string[], at: number): number {
  let depth = 0;
  for (let next = at; next < lines.length; next += 1) {
    const line = lines[next] ?? '';
    if (DETAILS_OPEN.test(line)) depth += 1;
    if (DETAILS_CLOSE.test(line)) depth -= 1;
    if (depth === 0) return next + 1;
  }
  return lines.length;
}

/** The toggle item at `at`'s children: the lines indented under it. Its end, exclusive. */
function toggleEnd(lines: readonly string[], at: number): number {
  const indent = indentOf(lines[at] ?? '');
  let end = at + 1;
  for (let next = at + 1; next < lines.length; next += 1) {
    const line = lines[next] ?? '';
    if (line.trim() === '') continue;
    if (indentOf(line) <= indent) break;
    end = next + 1;
  }
  return end;
}

/** The transcript block in the lines: where it starts and ends, and where its turns start. */
interface Block {
  readonly start: number;
  readonly content: number;
  readonly end: number;
}

/** The field a `#` or `##` heading opens, or null for a line that is not one. */
function headingField(line: string): Field | 'other' | null {
  const heading = SECTION_HEADING.exec(line)?.[1]?.toLowerCase();
  if (heading === undefined) return null;
  return FIELD_OF[heading] ?? 'other';
}

/** The code fence open after the line: a marker opens one, and the same marker, as long or longer, closes it. */
function fenceAfter(line: string, fence: string | null): string | null {
  const marker = FENCE.exec(line)?.[1];
  if (marker === undefined) return fence;
  if (fence === null) return marker;
  return marker.startsWith(fence) ? null : fence;
}

/**
 * The block starting at `at` when it is the transcript: a `<details>` at the
 * page's top level whose summary is Transcript, or a top-level toggle item
 * labelled Transcript that has lines indented under it. A bullet that only
 * reads "Transcript" is a bullet.
 */
function blockAt(lines: readonly string[], at: number): Block | null {
  const line = lines[at] ?? '';
  if (indentOf(line) > 0) return null;
  if (DETAILS_OPEN.test(line)) {
    // The mapper drops the `<details>` and `<summary>` lines themselves.
    const labelled = lines.slice(at, at + 2).some((each) => TRANSCRIPT_SUMMARY.test(each));
    return labelled ? { start: at, content: at, end: detailsEnd(lines, at) } : null;
  }
  if (!TRANSCRIPT_TOGGLE.test(line)) return null;
  const end = toggleEnd(lines, at);
  return end > at + 1 ? { start: at, content: at + 1, end } : null;
}

/**
 * The transcript block to take out of the page, or null to read the
 * transcript from a `## Transcript` section instead: one outside code, and
 * preferred to a block when the page has both. Only the first block is
 * taken; any other stays in its section as text.
 */
function transcriptBlock(lines: readonly string[]): Block | null {
  let fence: string | null = null;
  let found: Block | null = null;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    if (fence === null) {
      if (headingField(line) === 'transcript') return null;
      found ??= blockAt(lines, at);
    }
    fence = fenceAfter(line, fence);
  }
  return found;
}

/** Lines each field holds. A heading with no field of its own goes, with its line, into Details. */
function bySection(lines: readonly string[]): Map<Field, string[]> {
  const fields = new Map<Field, string[]>();
  const add = (field: Field, line: string) => {
    const held = fields.get(field);
    if (held === undefined) fields.set(field, [line]);
    else held.push(line);
  };
  let current: Field = 'details';
  let fence: string | null = null;
  for (const line of lines) {
    const field = fence === null ? headingField(line) : null;
    if (field === 'other') {
      current = 'details';
      add(current, line);
    } else if (field !== null) current = field;
    else add(current, line);
    fence = fenceAfter(line, fence);
  }
  return fields;
}

/**
 * The page's content split into the fields the mapper reads, by its `#` and
 * `##` headings outside code. The transcript is a `## Transcript` section,
 * else the top-level `<details>` (or toggle item) labelled Transcript. Text
 * before the first heading, and any heading the mapping has no field for,
 * goes into Details with its heading, so the page's content all arrives.
 */
export function pageSections(body: string): PageSections {
  const lines = body.split(/\r\n?|\n/);
  const block = transcriptBlock(lines);
  const rest = block === null ? lines : [...lines.slice(0, block.start), ...lines.slice(block.end)];
  const fields = bySection(rest);
  const text = (field: Field) => (fields.get(field) ?? []).join('\n').trim();
  return {
    attendees: text('attendees'),
    summary: text('summary'),
    decisions: text('decisions'),
    nextSteps: text('nextSteps'),
    details: text('details'),
    transcript:
      block === null ? text('transcript') : lines.slice(block.content, block.end).join('\n'),
  };
}
