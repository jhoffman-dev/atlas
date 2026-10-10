import type { Csv, CsvRow } from './notion-csv.ts';
import type { NotionPage } from './notion-page.ts';

/** A page of a database, from its file: the id Notion put in its name, and what it holds. */
export interface ExportPage {
  /** Where it is in the export, with `/`: for the report. */
  readonly file: string;
  readonly id: string | null;
  readonly page: NotionPage;
}

/** A row and the page that is its note, or why none could be told apart for it. */
export type PairedRow =
  | {
      readonly kind: 'paired';
      readonly title: string;
      readonly row: CsvRow;
      readonly page: ExportPage;
    }
  | { readonly kind: 'unpaired'; readonly title: string; readonly reason: string };

/** A row's title: the first column of a Notion CSV is the database's title property. */
export const rowTitle = (csv: Csv, row: CsvRow): string =>
  (row.get(csv.columns[0] ?? '') ?? '').trim();

/** How many of the row's other cells the page's properties repeat exactly. */
function agreement(csv: Csv, row: CsvRow, page: ExportPage): number {
  return csv.columns
    .slice(1)
    .filter(
      (column) =>
        (row.get(column) ?? '').trim() === (page.page.properties.get(column) ?? '').trim(),
    ).length;
}

/** Of pages sharing the row's title, the one whose properties agree with it most; null when two agree as much. */
function likeliest(csv: Csv, row: CsvRow, pages: readonly ExportPage[]): ExportPage | null {
  const scored = pages
    .map((page) => ({ page, score: agreement(csv, row, page) }))
    .sort((left, right) => right.score - left.score);
  const [best, next] = scored;
  return best !== undefined && (next === undefined || next.score < best.score) ? best.page : null;
}

/**
 * Each row of a database with its page. A Notion CSV has no page ids, so a
 * row is paired with the page of the same title — Notion writes it as the
 * page's `# heading`, in full, where the file name may be cut short — and,
 * when several pages share it, with the one whose properties agree with the
 * row. A row no page can be told apart for is listed, never given a guess.
 * Pages left over belong to no row.
 */
export function pairRows(
  csv: Csv,
  pages: readonly ExportPage[],
): { readonly rows: PairedRow[]; readonly leftOver: ExportPage[] } {
  const unclaimed = new Set(pages);
  const rows = csv.rows.map((row): PairedRow => {
    const title = rowTitle(csv, row);
    const candidates = [...unclaimed].filter((page) => page.page.title.trim() === title);
    if (candidates.length === 0) {
      return { kind: 'unpaired', title, reason: 'no page in the export has its title' };
    }
    const page = candidates.length === 1 ? candidates[0] : likeliest(csv, row, candidates);
    if (page === null || page === undefined) {
      return {
        kind: 'unpaired',
        title,
        reason: `${candidates.length} pages share its title and properties: no telling which is this row`,
      };
    }
    unclaimed.delete(page);
    return { kind: 'paired', title, row, page };
  });
  return { rows, leftOver: [...unclaimed] };
}
