import type { MeetingFields } from '../n8n/meeting-to-atlas.ts';
import type { Csv, CsvRow } from './notion-csv.ts';
import { notionWhen } from './notion-date.ts';
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

/** What becomes of one row: a meeting to map, or the reason it cannot be one. */
export type RowPlan =
  | { readonly kind: 'meeting'; readonly row: RowName; readonly fields: MeetingFields }
  | { readonly kind: 'no-source-id'; readonly row: RowName }
  | { readonly kind: 'no-page'; readonly row: RowName; readonly reason: string };

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

function planRow(row: CsvRow, pages: ReadonlyMap<string, NotionPage | null>): RowPlan {
  const name = { title: cell(row, COLUMNS.title), date: cell(row, COLUMNS.date) };
  const id = cell(row, COLUMNS.sourceId);
  if (id === '') return { kind: 'no-source-id', row: name };
  const page = pages.get(id);
  if (page === undefined) {
    return { kind: 'no-page', row: name, reason: `no page in the export holds Source ID ${id}` };
  }
  if (page === null) {
    return { kind: 'no-page', row: name, reason: `two pages in the export hold Source ID ${id}` };
  }
  return { kind: 'meeting', row: name, fields: fieldsOf(row, page) };
}

/**
 * Each row of a Meeting Notes export, paired with its page by Source ID. The
 * CSV says which meetings there are and holds their properties; the page
 * holds what was said. A row with no Source ID is named, never given one: the
 * id is what keeps a meeting from arriving twice (ADR-0027).
 */
export function planRows(csv: Csv, pages: readonly NotionPage[]): RowPlan[] {
  const missing = REQUIRED.filter((column) => !csv.columns.includes(column));
  if (missing.length > 0) {
    throw new NotionExportError(
      `the CSV has no ${missing.map((column) => `"${column}"`).join(', ')} column: export the Meeting Notes database (the _all.csv when there are two)`,
    );
  }
  const byId = pagesById(pages);
  return csv.rows.map((row) => planRow(row, byId));
}
