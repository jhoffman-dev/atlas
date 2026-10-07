/**
 * A subscription to something outside the vault, as a note.
 *
 * A source declares where data comes from, which folder it lands in, and which
 * field becomes which property. What arrives is written as ordinary markdown
 * notes, so views, boards, dashboards and the timeline all work on it without
 * knowing it came from somewhere else — and deleting Atlas leaves it behind.
 */

import { asName, isRecord } from '../query/frontmatter-query.ts';
import { createVaultPath, InvalidVaultPathError } from '../vault/vault-path.ts';
import { readSourceRequest } from './source-request.ts';

export type SourceFormat = 'ics' | 'csv' | 'json' | 'sqlite';

export const SOURCE_FORMATS: readonly SourceFormat[] = ['ics', 'csv', 'json', 'sqlite'];

/** The frontmatter key that marks a note as a source rather than prose. */
export const SOURCE_MARKER = 'atlas';
export const SOURCE_MARKER_VALUE = 'source';

/**
 * Written onto every note a source produces, so a refresh can find it again.
 *
 * Namespaced, because a vault is free to use plain names for its own meaning —
 * this one writes `source: you` on every task it added by hand — and a refresh
 * that took `source` would have rewritten that meaning under it.
 */
export const SOURCE_PATH_KEY = 'atlas_source';
export const SOURCE_KEY_KEY = 'atlas_source_key';
export const SOURCE_DIGEST_KEY = 'atlas_source_digest';
export const SOURCE_MISSING_KEY = 'atlas_source_missing';

/** How many notes one refresh may write, so a runaway feed cannot fill a disk. */
export const MAX_RECORDS = 2000;

export interface Datasource {
  readonly format: SourceFormat;
  /**
   * Where to fetch from, or null when the source reads a file. May name
   * secrets — `{{secret:calendar}}` — which only the host fills in.
   */
  readonly url: string | null;
  /**
   * A path inside the vault, or null when the source fetches. A SQLite file
   * may instead be an absolute path outside it, which the host opens only if
   * it was picked on this machine.
   */
  readonly file: string | null;
  /** Headers sent with a fetch, by name. Values may name secrets, never hold them. */
  readonly headers: Readonly<Record<string, string>>;
  /** For SQLite: the statement whose rows become notes. */
  readonly query: string | null;
  /** For JSON: the field the list of records sits under. */
  readonly pointer: string | null;
  /** The folder the notes land in. */
  readonly into: string;
  /** The type each note declares, so it can be queried like anything else. */
  readonly type: string;
  /** The field that identifies a record between refreshes. */
  readonly key: string;
  /** The field that names the note. */
  readonly name: string;
  /** The field whose text becomes the note's body, if any. */
  readonly body: string | null;
  /** Source field to note property. Fields not mentioned are not written. */
  readonly map: Readonly<Record<string, string>>;
  /** Minutes between refreshes. Zero means only when asked. */
  readonly interval: number;
}

export function isDatasource(frontmatter: Readonly<Record<string, unknown>>): boolean {
  return String(frontmatter[SOURCE_MARKER] ?? '').trim() === SOURCE_MARKER_VALUE;
}

/**
 * Reads a source out of a note's frontmatter, or null when it is not one, or
 * does not say enough to be usable.
 *
 * Unlike a view, a half-read source is refused rather than trimmed: fetching
 * into the wrong folder, or keying records on the wrong field, writes files.
 */
export function parseDatasource(frontmatter: Readonly<Record<string, unknown>>): Datasource | null {
  if (!isDatasource(frontmatter)) return null;

  const format = String(frontmatter['format'] ?? '').trim() as SourceFormat;
  if (!SOURCE_FORMATS.includes(format)) return null;

  const url = asName(frontmatter['url']);
  const file = asName(frontmatter['file']);
  // Nowhere to read from is no source at all, and two places to read from is a
  // source that does not say which: picking one would read a feed while the
  // other half of the note says the data is somewhere else.
  const places = [url, file].filter((place) => place !== null);
  if (places.length !== 1) return null;

  const into = asName(frontmatter['into']);
  const type = asName(frontmatter['type']);
  if (into === null || type === null) return null;
  // A folder that climbs out of the vault would have a refresh writing files
  // wherever it pointed, so the source is refused rather than corrected.
  if (!isVaultFolder(into)) return null;

  const query = asName(frontmatter['query']);
  // A SQLite file is read by a statement, and a URL is not a database: without
  // both there is nothing to run, and a query on a feed would be ignored.
  if ((format === 'sqlite') !== (file !== null && query !== null)) return null;
  if (format !== 'sqlite' && query !== null) return null;

  const headers = readSourceRequest({
    url,
    headers: frontmatter['headers'],
    auth: frontmatter['auth'],
  });
  if (headers === null) return null;

  return {
    format,
    url,
    file,
    headers,
    query,
    pointer: asName(frontmatter['pointer']),
    into,
    type,
    // A calendar keys on UID and names itself after its summary; those defaults
    // make the common case a three-line note.
    key: asName(frontmatter['key']) ?? (format === 'ics' ? 'uid' : 'id'),
    name: asName(frontmatter['name']) ?? (format === 'ics' ? 'summary' : 'name'),
    body: asName(frontmatter['body']),
    map: asMap(frontmatter['map']),
    interval: asInterval(frontmatter['interval']),
  };
}

function isVaultFolder(into: string): boolean {
  try {
    createVaultPath(into);
    return true;
  } catch (cause) {
    // Any other error is a bug here rather than a bad folder, so it is not
    // swallowed along with the one this asks about.
    if (cause instanceof InvalidVaultPathError) return false;
    throw cause;
  }
}

function asMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const map: Record<string, string> = {};
  for (const [from, to] of Object.entries(value)) {
    const property = asName(to);
    if (property !== null) map[from] = property;
  }
  return map;
}

function asInterval(value: unknown): number {
  const minutes = Number(value);
  // A refresh every few seconds is a mistake rather than a wish, so anything
  // under a minute is read as "only when asked".
  return Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : 0;
}
