import type { ImportedPage } from './note-merge.ts';

/**
 * Where the record of what the workspace import brought in is kept: in the
 * vault, beside the GTD move's record (`.atlas/migrations`), so it syncs to
 * every Mac with the notes it describes and a run from either knows what the
 * last one imported.
 */
export const RECORD_PATH = '.atlas/imports/notion-workspace.md';

/** What was imported for each Notion page, by its id. */
export type ImportRecord = ReadonlyMap<string, ImportedPage>;

/** A record that cannot be trusted: without it, every edit made in Atlas would look like Notion's to take. */
export class ImportRecordError extends Error {
  override readonly name = 'ImportRecordError';
  constructor(reason: string) {
    super(
      `${RECORD_PATH} cannot be read (${reason}): it says what the last run imported, so nothing was changed. Put it back from sync, or remove it to start the record again.`,
    );
  }
}

const FENCE = '```';
const OPENING = `\n${FENCE}json\n`;

/** The record as its file is written: a heading a person can read, then the pages as JSON. */
export function recordText(record: ImportRecord): string {
  const pages = Object.fromEntries(
    [...record].sort(([left], [right]) => left.localeCompare(right)),
  );
  return [
    '---',
    'atlas: import',
    'source: notion',
    '---',
    '',
    '# Notion workspace import',
    '',
    `What the last run imported for each of ${record.size} Notion pages, as digests: a later run`,
    'changes a property or a body only where the note still holds what was imported, so an edit',
    'made in Atlas is never written over. Removing this file makes the next run fill in only what',
    'the notes lack.',
    '',
    `${FENCE}json`,
    JSON.stringify({ version: 1, pages }),
    FENCE,
    '',
  ].join('\n');
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PAGE_ID = /^[0-9a-f]{32}$/;

function importedPage(id: string, raw: unknown): ImportedPage {
  if (!PAGE_ID.test(id)) throw new ImportRecordError(`"${id}" is not a Notion page id`);
  if (!isObject(raw) || !isObject(raw['fields']) || typeof raw['body'] !== 'string') {
    throw new ImportRecordError(`what it says of ${id} is not what the import writes`);
  }
  const fields = Object.entries(raw['fields']);
  if (fields.some(([, digest]) => typeof digest !== 'string')) {
    throw new ImportRecordError(`a property of ${id} has no digest`);
  }
  return { fields: Object.fromEntries(fields) as Record<string, string>, body: raw['body'] };
}

/** Reads a record back; anything but a record this import wrote is refused, never half read. */
export function parseRecord(text: string): ImportRecord {
  const opening = text.indexOf(OPENING);
  const start = opening + OPENING.length;
  const end = opening === -1 ? -1 : text.indexOf(`\n${FENCE}`, start);
  if (end === -1) throw new ImportRecordError('it has no list of pages');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end));
  } catch {
    throw new ImportRecordError('its list of pages is not JSON');
  }
  if (!isObject(parsed) || parsed['version'] !== 1 || !isObject(parsed['pages'])) {
    throw new ImportRecordError('it is not a record this import wrote');
  }
  return new Map(
    Object.entries(parsed['pages']).map(([id, raw]) => [id, importedPage(id, raw)] as const),
  );
}
