import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { messageWithoutPaths } from '../../packages/domain/src/index.ts';
import {
  ImportRecordError,
  parseRecord,
  recordText,
  RECORD_PATH,
  type ImportRecord,
} from './import-record.ts';
import { ImportSetupError, ownFolder } from './import-target.ts';
import { stageFile } from './staged-file.ts';

/** Where the record is on disk: in the vault's `.atlas/imports`, never through a link out of the vault. */
export async function recordFile(vault: string): Promise<string> {
  return join(await ownFolder(vault, dirname(RECORD_PATH)), basename(RECORD_PATH));
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The record of the last run; empty before the first. One that cannot be read stops the run. */
export async function readRecord(path: string): Promise<ImportRecord> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
  try {
    return parseRecord(UTF8.decode(bytes));
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ImportSetupError(new ImportRecordError('it is not UTF-8 text').message);
    }
    if (error instanceof ImportRecordError) throw new ImportSetupError(error.message);
    throw error;
  }
}

/**
 * Stops the run before it writes a note when the record could not be kept:
 * notes written without it would look, to the next run, like notes it never
 * imported, and Notion's next changes would be held back as edits.
 */
export async function checkRecordWritable(path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await (await stageFile(dirname(path), '')).discard();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error)) throw error;
    throw new ImportSetupError(
      `${RECORD_PATH} cannot be written (${messageWithoutPaths(error)}), so nothing was: it is how the next run tells your edits from Notion's`,
    );
  }
}

/**
 * Writes the record, whole under a hidden name and put in place in one step,
 * and only when it says something new, so a run that changes nothing writes
 * nothing.
 */
export async function saveRecord(path: string, record: ImportRecord): Promise<void> {
  const text = recordText(record);
  const before = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (before === text) return;
  const staged = await stageFile(dirname(path), text);
  try {
    await staged.replace(path);
  } finally {
    await staged.discard();
  }
}
