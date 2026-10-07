import {
  createVaultPath,
  parseCsv,
  parseIcs,
  parseJsonRecords,
  planRefresh,
  recordsFromRows,
  sourceRequest,
  missingProperties,
  splitFrontmatter,
  SOURCE_DIGEST_KEY,
  SOURCE_KEY_KEY,
  SOURCE_MISSING_KEY,
  SOURCE_PATH_KEY,
  type Datasource,
  type ExistingSourceNote,
  type SourceRecord,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { NoteFile, VaultFsPort } from '../vault/ports.ts';
import type { HttpPort, SqliteSourcePort } from './ports.ts';

/** What one refresh did, as the source note's panel reports it. */
export interface SourceReport {
  /** When it ran, as the caller's clock gave it. */
  readonly ran: number;
  /** The URL or vault file it read, so the panel can say where data came from. */
  readonly from: string;
  readonly records: number;
  readonly created: number;
  readonly replaced: number;
  /** Notes whose body you have edited: their properties were refreshed, not their text. */
  readonly updated: number;
  /** Notes whose record is no longer in the feed. Marked, never deleted. */
  readonly missing: number;
  /** Records with nothing in the key field, which cannot be followed over time. */
  readonly unkeyed: number;
  readonly truncated: boolean;
  readonly error: string | null;
}

/**
 * Fetches a source and writes what it holds into the vault as ordinary notes.
 *
 * Failure is a report rather than a rejection: a feed that is down, a file that
 * has moved or text that will not parse is something the source note should say
 * out loud, and the counts from whatever did land are still worth showing.
 */
export async function refreshSource({
  fs,
  markdown,
  index,
  http,
  sqlite,
  sourcePath,
  source,
  vault,
  now,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  http: HttpPort;
  sqlite: Pick<SqliteSourcePort, 'query'>;
  /** The source note itself, written onto every note it produces. */
  sourcePath: string;
  source: Datasource;
  /** The vault the refresh runs in: its secrets, and no other vault's, are sent. */
  vault: string;
  /** The current time, injected: this use-case never reads a clock of its own. */
  now: number;
}): Promise<SourceReport> {
  const from = source.url ?? source.file ?? '';
  const tally = { records: 0, created: 0, replaced: 0, updated: 0, missing: 0, unkeyed: 0 };
  let truncated = false;

  try {
    const read = await readSource({ fs, http, sqlite, source, vault });
    const { records } = read;
    tally.records = records.length;

    const produced = await notesFrom({ fs, markdown, index, source, sourcePath });
    const plan = planRefresh({
      source,
      sourcePath,
      records,
      existing: produced.map(({ note }) => note),
    });
    tally.unkeyed = plan.unkeyed;
    truncated = plan.truncated || read.truncated;

    const filesByPath = new Map(produced.map(({ note, file }) => [note.path, file] as const));

    for (const write of plan.writes) {
      if (write.kind === 'create') {
        await fs.createNote({
          path: createVaultPath(write.path),
          // The body is written exactly as the record gave it, with nothing
          // added: the digest beside it is a digest of that text, and a stray
          // blank line here would make every note look edited by hand.
          contents: markdown.updateFrontmatter(null, write.properties) + write.body,
        });
        tally.created += 1;
        continue;
      }

      const file = filesByPath.get(write.path);
      // Only a note this refresh already read can be rewritten, and every
      // non-create write names one, so a missing entry is not reachable.
      if (file === undefined) continue;

      const document = splitFrontmatter(file.text);
      await fs.writeTextFile({
        path: createVaultPath(write.path),
        contents:
          markdown.updateFrontmatter(document.frontmatter, write.properties) +
          (write.kind === 'replace' ? write.body : document.body),
        expectedModified: file.modified,
      });
      if (write.kind === 'replace') tally.replaced += 1;
      else tally.updated += 1;
    }

    // Marked after the writes, and never on a path this same refresh wrote to:
    // a note that just received a record is not a note whose record has gone.
    const refreshed = new Set(plan.writes.map((write) => write.path));
    const gone = plan.missing.filter((path) => !refreshed.has(path));
    tally.missing = gone.length;

    for (const path of gone) {
      const found = produced.find(({ note }) => note.path === path);
      // Marked once and left alone: rewriting the mark on every refresh would
      // churn the file and the index for a note nothing has changed about.
      if (found === undefined || found.alreadyMissing) continue;

      const document = splitFrontmatter(found.file.text);
      await fs.writeTextFile({
        path: createVaultPath(path),
        contents:
          markdown.updateFrontmatter(document.frontmatter, missingProperties()) + document.body,
        expectedModified: found.file.modified,
      });
    }

    return { ran: now, from, ...tally, truncated, error: null };
  } catch (error) {
    return {
      ran: now,
      from,
      ...tally,
      truncated,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** What a source holds, and whether the host stopped reading it short. */
interface SourceRead {
  readonly records: readonly SourceRecord[];
  readonly truncated: boolean;
}

async function readSource({
  fs,
  http,
  sqlite,
  source,
  vault,
}: {
  fs: VaultFsPort;
  http: HttpPort;
  sqlite: Pick<SqliteSourcePort, 'query'>;
  source: Datasource;
  vault: string;
}): Promise<SourceRead> {
  if (source.format === 'sqlite') {
    const rows = await sqlite.query({ file: source.file ?? '', sql: source.query ?? '' });
    return { records: recordsFromRows(rows), truncated: rows.truncated };
  }
  return {
    records: recordsIn(source, await readText({ fs, http, source, vault })),
    truncated: false,
  };
}

async function readText({
  fs,
  http,
  source,
  vault,
}: {
  fs: VaultFsPort;
  http: HttpPort;
  source: Datasource;
  vault: string;
}): Promise<string> {
  const request = sourceRequest(source);
  if (request !== null) return http.get({ request, vault });
  const { text } = await fs.readTextFile(createVaultPath(source.file ?? ''));
  return text;
}

function recordsIn(source: Datasource, text: string): readonly SourceRecord[] {
  if (source.format === 'csv') return parseCsv(text);
  if (source.format === 'json') return parseJsonRecords(text, source.pointer);
  return parseIcs(text);
}

/** A note this source produced, as the plan needs it and as the writer needs it. */
interface ProducedNote {
  readonly note: ExistingSourceNote;
  readonly file: NoteFile;
  readonly alreadyMissing: boolean;
}

/**
 * The notes this source has already produced.
 *
 * The index says which notes of this type exist, which finds the ones you have
 * moved elsewhere; the destination folder is listed as well, because the index
 * is derived and may not have caught up with the notes the last refresh wrote.
 * Either way the files decide: a note counts only if it still says it came from
 * this source.
 */
async function notesFrom({
  fs,
  markdown,
  index,
  source,
  sourcePath,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  source: Datasource;
  sourcePath: string;
}): Promise<readonly ProducedNote[]> {
  const indexed = await index.notesOfType(source.type);
  const candidates = new Set([
    ...indexed.map((note) => note.path),
    ...(await inFolder(fs, source)),
  ]);

  const files = await fs.readNotes([...candidates]);

  return files.flatMap((file) => {
    const document = splitFrontmatter(file.text);
    const properties = markdown.frontmatterProperties(document.frontmatter);
    if (properties[SOURCE_PATH_KEY] !== sourcePath) return [];

    return [
      {
        note: {
          path: file.path,
          key: String(properties[SOURCE_KEY_KEY] ?? ''),
          digest: String(properties[SOURCE_DIGEST_KEY] ?? ''),
          body: document.body,
        },
        file,
        alreadyMissing: properties[SOURCE_MISSING_KEY] === true,
      },
    ];
  });
}

async function inFolder(fs: VaultFsPort, source: Datasource): Promise<readonly string[]> {
  try {
    const entries = await fs.listDirectory(createVaultPath(source.into));
    return entries
      .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.md'))
      .map((entry) => entry.path);
  } catch {
    // The folder a source writes into does not have to exist before the first
    // refresh, and a folder that cannot be listed simply holds nothing this
    // refresh can reuse. Anything that really is wrong with it surfaces when
    // the first note is written there.
    return [];
  }
}
