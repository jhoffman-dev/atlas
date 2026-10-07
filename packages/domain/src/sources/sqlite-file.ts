/**
 * A SQLite file as a source: where the note says it is, and how its rows
 * become the same plain records every other format produces.
 */

import type { SourceRecord } from './records.ts';

/** Rows as the host returns them: column names, then one value per column. */
export interface SqliteRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /** True when the host's row cap stopped the result short. */
  readonly truncated: boolean;
}

/**
 * Rows as records. A NULL is no field at all — as a CSV's empty cell is not a
 * value — and a column named twice keeps its first value, which is the one a
 * reader of `SELECT a.id, b.id` sees first.
 */
export function recordsFromRows({ columns, rows }: SqliteRows): SourceRecord[] {
  return rows.map((row) => {
    const record: Record<string, string> = {};
    columns.forEach((column, at) => {
      const value = row[at];
      if (value === null || value === undefined || column in record) return;
      record[column] = String(value);
    });
    return record;
  });
}

/** True for a file named from the root of the disk rather than the vault. */
export function isOutsideVault(file: string): boolean {
  return file.startsWith('/');
}

/**
 * How a source note should name a file picked on disk.
 *
 * Inside the vault it is written relative to it, so the note keeps working
 * when the vault moves or is cloned elsewhere; outside, only the absolute
 * path says where it is, and it only works on this machine.
 */
export function sqliteFileReference({
  picked,
  vaultRoot,
}: {
  picked: string;
  vaultRoot: string;
}): string {
  const root = vaultRoot.replace(/\/+$/, '');
  return picked.startsWith(`${root}/`) ? picked.slice(root.length + 1) : picked;
}
