/** One CSV row, by its header's column names; a column the row lacks reads as ''. */
export type CsvRow = ReadonlyMap<string, string>;

/** A CSV's column names, from its header, and its rows. */
export interface Csv {
  readonly columns: readonly string[];
  readonly rows: readonly CsvRow[];
}

/** A CSV that cannot be read as one: a quote never closed. */
export class CsvError extends Error {
  override readonly name = 'CsvError';
}

/** The cells of the text, row by row, as RFC 4180 reads them: quoted cells may hold commas, quotes and line breaks. */
function cells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const each = text[at];
    if (quoted) {
      if (each === '"' && text[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (each === '"') quoted = false;
      else cell += each;
    } else if (each === '"') quoted = true;
    else if (each === ',') {
      row.push(cell);
      cell = '';
    } else if (each === '\n' || each === '\r') {
      if (each === '\r' && text[at + 1] === '\n') at += 1;
      rows.push([...row, cell]);
      row = [];
      cell = '';
    } else cell += each;
  }
  if (quoted) throw new CsvError('a quoted cell is never closed');
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

const isBlank = (row: readonly string[]) => row.every((cell) => cell.trim() === '');

/**
 * A Notion CSV export as rows keyed by its header. Notion starts the file
 * with a byte order mark; trimming the column names takes it off the first.
 */
export function readCsv(text: string): Csv {
  const [header = [], ...body] = cells(text).filter((row) => !isBlank(row));
  const columns = header.map((name) => name.trim());
  return {
    columns,
    rows: body.map((row) => new Map(columns.map((name, at) => [name, row[at] ?? '']))),
  };
}
