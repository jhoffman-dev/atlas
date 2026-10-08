import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';

/**
 * The record of the status migration (ADR-0029), kept in the vault so it can
 * be undone from either Mac, after a restart, and after a run that stopped
 * partway and was run again: one record covers the run until it is undone.
 *
 * It holds each changed file's frontmatter as it was and as the migration
 * wrote it, so undoing puts back the exact bytes — and only where the file
 * still says what the migration wrote. A file the migration made is held
 * whole, and taken away only while it is still as made.
 */
export const MIGRATION_RECORD_PATH: VaultPath = createVaultPath(
  `${ATLAS_DIRECTORY}/migrations/task-statuses.md`,
);

export type RecordedFile =
  | {
      readonly kind: 'changed';
      readonly path: VaultPath;
      /** The frontmatter block as it was, delimiters included. */
      readonly before: string;
      /** The frontmatter block as the migration wrote it. */
      readonly after: string;
    }
  | { readonly kind: 'created'; readonly path: VaultPath; readonly contents: string };

export interface MigrationRecord {
  /** When the run began, on the wall clock: `2026-10-08T09:30:00`. */
  readonly at: string;
  readonly files: readonly RecordedFile[];
}

/** A record that cannot be trusted to undo with: its file is not one the migration wrote. */
export class MigrationRecordError extends Error {
  constructor(reason: string) {
    super(`The migration's record cannot be read, so nothing was undone: ${reason}`);
    this.name = 'MigrationRecordError';
  }
}

const FENCE = '```';
const OPENING = `\n${FENCE}json\n`;

/** The record as its file is written: a heading a person can read, then the files as JSON. */
export function migrationRecordText(record: MigrationRecord): string {
  return [
    '---',
    'atlas: migration',
    `at: ${record.at}`,
    '---',
    '',
    '# Task statuses moved to GTD',
    '',
    `${record.files.length} files were changed or added. Undo puts back each one that still says what the`,
    'migration wrote; this file goes when the migration is undone.',
    '',
    `${FENCE}json`,
    JSON.stringify({ at: record.at, files: record.files }),
    FENCE,
    '',
  ].join('\n');
}

/**
 * Reads a record back. The file is a note any tool could have written, so a
 * file is only trusted to put back what is a frontmatter block, to a path in
 * the vault that is not the record itself.
 */
export function parseMigrationRecord(text: string): MigrationRecord {
  const opening = text.indexOf(OPENING);
  const start = opening + OPENING.length;
  const end = opening === -1 ? -1 : text.indexOf(`\n${FENCE}`, start);
  if (end === -1) throw new MigrationRecordError('it has no list of files.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end));
  } catch {
    throw new MigrationRecordError('its list of files is not JSON.');
  }
  if (!isObject(parsed) || typeof parsed['at'] !== 'string' || !Array.isArray(parsed['files'])) {
    throw new MigrationRecordError('it does not say when it ran and what it changed.');
  }
  return { at: parsed['at'], files: parsed['files'].map(recordedFile) };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether text is one whole frontmatter block, as a split of a file would give it. */
const isFrontmatterBlock = (text: unknown): text is string =>
  typeof text === 'string' && splitFrontmatter(text).frontmatter === text;

function recordedFile(raw: unknown): RecordedFile {
  if (!isObject(raw) || typeof raw['path'] !== 'string') {
    throw new MigrationRecordError('a file in it has no path.');
  }
  let path: VaultPath;
  try {
    path = createVaultPath(raw['path']);
  } catch {
    throw new MigrationRecordError(`“${raw['path']}” is not a place in the vault.`);
  }
  if (foldedVaultPath(path) === foldedVaultPath(MIGRATION_RECORD_PATH)) {
    throw new MigrationRecordError('it names itself.');
  }
  if (raw['kind'] === 'created' && typeof raw['contents'] === 'string') {
    return { kind: 'created', path, contents: raw['contents'] };
  }
  if (
    raw['kind'] === 'changed' &&
    isFrontmatterBlock(raw['before']) &&
    isFrontmatterBlock(raw['after'])
  ) {
    return { kind: 'changed', path, before: raw['before'], after: raw['after'] };
  }
  throw new MigrationRecordError(`what it says of “${path}” is not a change it could have made.`);
}

/**
 * A run that went on after one that stopped partway — on this Mac, or from a
 * record another Mac's partial run synced in: one record for both, so one
 * undo covers both.
 *
 * A file in both keeps what it was before the first run only while it still
 * held what the first run wrote when the second read it. Otherwise the first
 * run never wrote it, or it changed since — by hand, or by sync — and what
 * the second run found is what undo must give back, or that change is lost.
 */
export function mergedRecord(
  earlier: MigrationRecord | null,
  later: MigrationRecord,
): MigrationRecord {
  if (earlier === null) return later;
  const files = new Map(earlier.files.map((file) => [file.path, file]));
  for (const file of later.files) {
    files.set(file.path, mergedFile(files.get(file.path), file));
  }
  return { at: earlier.at, files: [...files.values()] };
}

function mergedFile(first: RecordedFile | undefined, later: RecordedFile): RecordedFile {
  if (first === undefined) return later;
  if (first.kind === 'changed' && later.kind === 'changed') {
    return first.after === later.before ? { ...later, before: first.before } : later;
  }
  return first;
}
