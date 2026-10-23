import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSemanticEngine, fakeEmbedder, type FakeEmbedder } from '@dfai/application';
import { digestOf } from '@dfai/domain';

/**
 * Semantic search end to end on this side of the boundary: notes in a real
 * folder, read through the vault adapter, parsed by the real markdown port,
 * and cached through the cache adapter into a real SQLite file in the
 * folder's `.atlas-cache/` that outlives the engine — as the cache outlives
 * the app between launches.
 *
 * The host is stood in for by what follows, which runs the SQL and writes the
 * bytes `src-tauri/src/embedding_cache.rs` does (its own tests cover its SQL).
 * The model is the application's deterministic fake.
 */

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriEmbeddingCache } = await import('./tauri-embedding-cache.ts');
const { tauriVaultFs } = await import('../vault/tauri-vault-fs.ts');
const { remarkMarkdown } = await import('../markdown/markdown-port.ts');

const TABLES = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, digest TEXT NOT NULL, title TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS block_embeddings (path TEXT NOT NULL, ordinal INTEGER NOT NULL,
    digest TEXT NOT NULL, anchor TEXT, heading TEXT, excerpt TEXT NOT NULL, vector BLOB,
    PRIMARY KEY (path, ordinal)) WITHOUT ROWID;`;

interface SentBlock {
  ordinal: number;
  digest: string;
  anchor: string | null;
  heading: string | null;
  excerpt: string;
  vector: number[] | null;
}

/** The host's cache commands over a vault folder, as `embedding_cache.rs` runs them. */
function hostFor(root: string) {
  const file = join(root, '.atlas-cache', 'embeddings.sqlite');
  let database: DatabaseSync | null = null;
  const opened = () => {
    if (database === null) throw new Error('the embeddings cache is not open');
    return database;
  };
  const generationOf = (db: DatabaseSync) =>
    (
      db.prepare("SELECT value FROM meta WHERE key = 'generation'").get() as
        { value: string } | undefined
    )?.value;
  const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
    read_notes: async ({ paths }) =>
      (
        await Promise.all(
          (paths as string[]).map(async (path) => {
            const full = join(root, path);
            if (!existsSync(full)) return null;
            const text = await readFile(full, 'utf8');
            return { path, text, modified: 1, size: text.length };
          }),
        )
      ).filter((note) => note !== null),
    embedding_cache_open: ({ generation }) => {
      // Opening again replaces the connection; a file of another generation is made afresh.
      database?.close();
      const wanted = `${String(generation)}+model`;
      database = new DatabaseSync(file);
      database.exec(TABLES);
      const fresh = generationOf(database) !== wanted;
      if (fresh) {
        database.exec('DELETE FROM block_embeddings; DELETE FROM notes;');
        database
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('generation', ?)")
          .run(wanted);
      }
      return { fresh };
    },
    embedding_cache_load: () => load(opened()),
    embedding_cache_excerpts: ({ keys }) =>
      (keys as { path: string; ordinal: number }[]).map(
        ({ path, ordinal }) =>
          (
            opened()
              .prepare('SELECT excerpt FROM block_embeddings WHERE path = ? AND ordinal = ?')
              .get(path, ordinal) as { excerpt: string } | undefined
          )?.excerpt ?? '',
      ),
    embedding_cache_put: ({ vault, notes }) => {
      if (vault !== root) throw 'another vault was opened before this could be cached';
      const db = opened();
      db.exec('BEGIN');
      for (const note of notes as {
        path: string;
        digest: string;
        title: string;
        blocks: SentBlock[];
      }[]) {
        db.prepare('DELETE FROM block_embeddings WHERE path = ?').run(note.path);
        for (const block of note.blocks) {
          const bytes =
            block.vector === null ? null : new Uint8Array(Float32Array.from(block.vector).buffer);
          db.prepare(
            'INSERT INTO block_embeddings (path, ordinal, digest, anchor, heading, excerpt, vector) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            note.path,
            block.ordinal,
            block.digest,
            block.anchor,
            block.heading,
            block.excerpt,
            bytes,
          );
        }
        db.prepare('INSERT OR REPLACE INTO notes (path, digest, title) VALUES (?, ?, ?)').run(
          note.path,
          note.digest,
          note.title,
        );
      }
      db.exec('COMMIT');
      return null;
    },
    embedding_cache_remove: ({ paths }) => {
      for (const path of paths as string[]) {
        opened().prepare('DELETE FROM block_embeddings WHERE path = ?').run(path);
        opened().prepare('DELETE FROM notes WHERE path = ?').run(path);
      }
      return null;
    },
  };
  return {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      const run = commands[command];
      if (run === undefined) throw new Error(`unexpected command ${command}`);
      return run(args);
    },
    close: () => database?.close(),
  };
}

/** The load's bytes, as `embedding_cache.rs` writes them: header length, JSON header, vectors. */
function load(db: DatabaseSync): ArrayBuffer {
  const notes = db.prepare('SELECT path, digest, title FROM notes ORDER BY path').all();
  const rows = db
    .prepare(
      'SELECT path, ordinal, digest, anchor, heading, vector FROM block_embeddings ORDER BY path, ordinal',
    )
    .all() as {
    path: string;
    ordinal: number;
    digest: string;
    anchor: string | null;
    heading: string | null;
    vector: Uint8Array | null;
  }[];
  const header = new TextEncoder().encode(
    JSON.stringify({
      notes: notes.map((note) => ({ ...note })),
      blocks: rows.map(({ vector, ...row }) => ({ ...row, embedded: vector !== null })),
    }),
  );
  const vectors = rows.flatMap((row) => (row.vector === null ? [] : [...row.vector]));
  const bytes = new Uint8Array(4 + header.length + vectors.length);
  new DataView(bytes.buffer).setUint32(0, header.length, true);
  bytes.set(header, 4);
  bytes.set(vectors, 4 + header.length);
  return bytes.buffer;
}

let root: string;
let host: ReturnType<typeof hostFor>;

async function writeNote(path: string, text: string) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
}

function engineOver(notes: Record<string, string>, embedder: FakeEmbedder = fakeEmbedder()) {
  const engine = createSemanticEngine({
    vault: root,
    fs: tauriVaultFs,
    markdown: remarkMarkdown,
    index: {
      manifest: async () =>
        Object.entries(notes).map(([path, text]) => ({
          path,
          digest: digestOf(text),
          type: null,
          modified: 1,
          size: text.length,
        })),
    },
    embedder,
    cache: tauriEmbeddingCache,
    idle: { idle: async () => undefined },
    optIn: { isOn: () => true, turnOn: () => undefined },
  });
  return { engine, embedder };
}

const NOTES: Record<string, string> = {
  'Meetings/Standup.md':
    '---\ntitle: Monday standup\n---\n\n## Payroll\n\nMara Quill moves payday to Friday. ^k3x9a1\n\n- The printer is broken again\n- Tobias Fenn orders toner\n',
  'Home/Garden.md': '# Garden\n\nTobias Fenn keeps bees behind the shed.\n',
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-semantic-')));
  await mkdir(join(root, '.atlas-cache'));
  for (const [path, text] of Object.entries(NOTES)) await writeNote(path, text);
  host = hostFor(root);
  invoke.mockReset();
  invoke.mockImplementation(host.invoke);
});

afterEach(async () => {
  host.close();
  await rm(root, { recursive: true, force: true });
});

describe('semantic search over a real folder and a real SQLite cache', () => {
  it('finds a block by meaning, under its page title, linked by its id', async () => {
    const { engine } = engineOver(NOTES);
    await engine.start();
    await engine.settled();
    const { hits } = await engine.search({ query: 'when are wages paid' });
    expect(hits[0]).toMatchObject({
      path: 'Meetings/Standup.md',
      title: 'Monday standup',
      text: 'Mara Quill moves payday to Friday.',
      heading: 'Payroll',
      block: 'k3x9a1',
      link: '[[Standup#^k3x9a1]]',
    });
  });

  it('keeps the cache in the vault’s cache folder, beside the index', async () => {
    const { engine } = engineOver(NOTES);
    await engine.start();
    await engine.settled();
    expect(existsSync(join(root, '.atlas-cache', 'embeddings.sqlite'))).toBe(true);
  });

  it('answers the same after the cache file is deleted and built again', async () => {
    const first = engineOver(NOTES);
    await first.engine.start();
    await first.engine.settled();
    const before = await first.engine.search({ query: 'printer toner', limit: 10 });
    host.close();
    await rm(join(root, '.atlas-cache', 'embeddings.sqlite'), { force: true });

    host = hostFor(root);
    invoke.mockImplementation(host.invoke);
    const again = engineOver(NOTES);
    await again.engine.start();
    await again.engine.settled();
    expect(again.embedder.passages()).toEqual(first.embedder.passages());
    expect(await again.engine.search({ query: 'printer toner', limit: 10 })).toEqual(before);
  });

  it('resumes from the file after a relaunch, embedding nothing it already holds', async () => {
    const first = engineOver(NOTES);
    await first.engine.start();
    await first.engine.settled();
    host.close();
    host = hostFor(root);
    invoke.mockImplementation(host.invoke);

    const edited = {
      ...NOTES,
      'Home/Garden.md':
        '# Garden\n\nTobias Fenn keeps bees behind the shed.\n\nThe hive needs a new roof.\n',
    };
    await writeNote('Home/Garden.md', edited['Home/Garden.md'] as string);
    const relaunched = engineOver(edited);
    await relaunched.engine.start();
    await relaunched.engine.settled();
    expect(relaunched.embedder.passages()).toEqual(['Garden\nThe hive needs a new roof.']);
    const { hits } = await relaunched.engine.search({ query: 'honey' });
    expect(hits.map((hit) => hit.text)).toContain('Tobias Fenn keeps bees behind the shed.');
  });

  it('says the model could not be had, keeps what is cached, and holds no note half written', async () => {
    let offline: string | null = 'the model could not be fetched: no network';
    const embedder = fakeEmbedder({ failWith: () => offline });
    const { engine } = engineOver(NOTES, embedder);
    await engine.start();
    await engine.settled();
    expect(engine.progress().failure).toContain('no network');
    const database = new DatabaseSync(join(root, '.atlas-cache', 'embeddings.sqlite'));
    expect(database.prepare('SELECT COUNT(*) AS n FROM notes').get()).toEqual({ n: 0 });
    database.close();
    offline = null;
    await engine.search({ query: 'bees' });
    await engine.settled();
    expect(engine.progress()).toEqual({ done: 0, total: 0, failure: null });
  });
});
