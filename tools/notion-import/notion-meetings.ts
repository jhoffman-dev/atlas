import type { MeetingIdentity } from '../../packages/domain/src/index.ts';
import { oneLine } from '../n8n/meeting-mapping-error.ts';
import type { MeetingFields } from '../n8n/meeting-to-atlas.ts';
import type { Csv, CsvRow } from './notion-csv.ts';
import { notionWhen } from './notion-date.ts';
import { fromArrival, GEMINI, type GeminiDates } from './gemini-dates.ts';
import { pageSections, type NotionPage } from './notion-page.ts';

/** The Meeting Notes database's columns (ADR-0027), by what the mapper reads from each. */
export const COLUMNS = {
  title: 'Meeting name',
  date: 'Date',
  category: 'Category',
  source: 'Source',
  sourceId: 'Source ID',
} as const;

/** The columns without which no row can become a meeting; Category may be left out. */
const REQUIRED = [COLUMNS.title, COLUMNS.date, COLUMNS.source, COLUMNS.sourceId];

/** The export is not the Meeting Notes database: a column every meeting needs is missing. */
export class NotionExportError extends Error {
  override readonly name = 'NotionExportError';
}

/** A row as the report names it. */
export interface RowName {
  readonly title: string;
  readonly date: string;
}

/** A row with a meeting the vault may already hold, and why it is not brought in now. */
interface Waiting {
  readonly row: RowName;
  readonly identity: MeetingIdentity;
  readonly reason: string;
}

/** What becomes of one row: a meeting to map, or the reason it is not one yet. */
export type RowPlan =
  | {
      readonly kind: 'meeting';
      readonly row: RowName;
      readonly identity: MeetingIdentity;
      readonly fields: MeetingFields;
    }
  | { readonly kind: 'no-source-id'; readonly row: RowName }
  | { readonly kind: 'left-out'; readonly row: RowName; readonly reason: string }
  | ({ readonly kind: 'no-page' } & Waiting)
  | ({ readonly kind: 'held' } & Waiting);

/** Which rows to bring in, and how. */
export interface RowChoices {
  /** The providers to import, lower case; null for all of them. */
  readonly providers: readonly string[] | null;
  /** How Gemini's Dates are read; null holds Gemini's rows (issue #44). */
  readonly geminiDates: GeminiDates | null;
}

const cell = (row: CsvRow, column: string) => (row.get(column) ?? '').trim();

/** Pages by the Source ID they hold; null for an id two pages hold, which names neither. */
function pagesById(pages: readonly NotionPage[]): Map<string, NotionPage | null> {
  const byId = new Map<string, NotionPage | null>();
  for (const page of pages) {
    const id = page.properties.get(COLUMNS.sourceId)?.trim() ?? '';
    if (id !== '') byId.set(id, byId.has(id) ? null : page);
  }
  return byId;
}

function fieldsOf(row: CsvRow, page: NotionPage): MeetingFields {
  const when = notionWhen(cell(row, COLUMNS.date));
  const sections = pageSections(page.body);
  return {
    title: cell(row, COLUMNS.title),
    date: when.date,
    end: when.end,
    attendees: sections.attendees,
    summary: sections.summary,
    decisions: sections.decisions,
    nextSteps: sections.nextSteps,
    details: sections.details,
    transcript: sections.transcript,
    category: cell(row, COLUMNS.category),
    source: cell(row, COLUMNS.source),
    sourceId: cell(row, COLUMNS.sourceId),
  };
}

/** The page's meeting, read for the provider's Dates. */
function meetingOf(
  plan: { row: RowName; identity: MeetingIdentity },
  fields: MeetingFields,
  choices: RowChoices,
): RowPlan {
  if (plan.identity.provider !== GEMINI) return { kind: 'meeting', ...plan, fields };
  if (choices.geminiDates === null) {
    return { kind: 'held', ...plan, reason: 'gemini dates need --gemini-dates (issue #44)' };
  }
  return { kind: 'meeting', ...plan, fields: fromArrival(fields) };
}

function planRow(
  row: CsvRow,
  pages: ReadonlyMap<string, NotionPage | null>,
  choices: RowChoices,
): RowPlan {
  const name = { title: cell(row, COLUMNS.title), date: cell(row, COLUMNS.date) };
  const id = cell(row, COLUMNS.sourceId);
  if (id === '') return { kind: 'no-source-id', row: name };
  // As the mapper writes them, so a row is matched against the vault before it is mapped.
  const identity = {
    provider: oneLine(cell(row, COLUMNS.source)).toLowerCase(),
    externalId: oneLine(id),
  };
  if (choices.providers !== null && !choices.providers.includes(identity.provider)) {
    const reason = `${identity.provider || 'no provider'} is not among --providers`;
    return { kind: 'left-out', row: name, reason };
  }
  const page = pages.get(id);
  if (page === undefined || page === null) {
    const reason =
      page === null
        ? `two pages in the export hold Source ID ${id}`
        : `no page in the export holds Source ID ${id}`;
    return { kind: 'no-page', row: name, identity, reason };
  }
  return meetingOf({ row: name, identity }, fieldsOf(row, page), choices);
}

/**
 * Each row of a Meeting Notes export, paired with its page by Source ID. The
 * CSV says which meetings there are and holds their properties; the page
 * holds what was said. A row with no Source ID is named, never given one: the
 * id is what keeps a meeting from arriving twice (ADR-0027). A row of a
 * provider not chosen is left out, and a Gemini row is held unless a way to
 * read its Date was chosen (issue #44).
 */
export function planRows(csv: Csv, pages: readonly NotionPage[], choices: RowChoices): RowPlan[] {
  const missing = REQUIRED.filter((column) => !csv.columns.includes(column));
  if (missing.length > 0) {
    throw new NotionExportError(
      `the CSV has no ${missing.map((column) => `"${column}"`).join(', ')} column: export the Meeting Notes database (the _all.csv when there are two)`,
    );
  }
  const byId = pagesById(pages);
  return csv.rows.map((row) => planRow(row, byId, choices));
}
