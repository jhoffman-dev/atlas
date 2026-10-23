import {
  chunkExcerpt,
  createVaultPath,
  digestOf,
  embeddingWork,
  isEmbeddableNote,
  messageWithoutPaths,
  noteTitle,
  numbered,
  type NoteChange,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { embedPassages, PASSAGES_PER_CALL, type KnownVectors } from './embed-passages.ts';
import { notePassages, type NotePassages } from './note-passages.ts';
import type { EmbeddingCachePort, EmbeddingPort, IdlePort, NoteToCache } from './ports.ts';
import type { HeldNote, SemanticBlocks } from './semantic-blocks.ts';

/** The most notes read before what they need is embedded and written. */
const NOTES_PER_WRITE = 16;

/** How far the build has got since it last had nothing to do. */
export interface BuildProgress {
  /** Notes embedded, or forgotten, since the build last had nothing to do. */
  readonly done: number;
  /** Those, and the notes still waiting. */
  readonly total: number;
  /** Why the build stopped, when it did; it starts again on the next `resume`. */
  readonly failure: string | null;
}

/**
 * Keeps the embeddings cache in step with a vault's notes, in the background
 * (P32-02). Notes are read and cut one per idle moment of the window, so
 * typing never waits behind the build; the model runs in the host, off the
 * window's thread. Each write holds whole notes, so a build stopped at any
 * point — a quit, a crash, a switch of vault — leaves only notes it had not
 * reached, and the next one starts from them (`embeddingWork`).
 */
export interface EmbeddingBuild {
  /** Queues the work between the cache and the vault's notes, named by path to digest. */
  plan(vault: ReadonlyMap<string, string>): void;
  /** Queues what one sync of the index found added, changed or removed. */
  hear(changes: readonly NoteChange[]): void;
  /** Starts again after a failure, with whatever is still queued. */
  resume(): void;
  /** Resolves once nothing is queued, the build has failed, or it was stopped. */
  settled(): Promise<void>;
  progress(): BuildProgress;
  /** Stops after the write under way, if any; nothing more is read, embedded or written. */
  stop(): void;
}

export interface EmbeddingBuildDeps {
  /** The vault the build is for: every write names it, and is refused once another is open. */
  readonly vault: string;
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: MarkdownPort;
  readonly embedder: EmbeddingPort;
  readonly cache: Pick<EmbeddingCachePort, 'put' | 'remove'>;
  readonly idle: IdlePort;
  readonly blocks: SemanticBlocks;
  /** Told each time the progress moves. */
  readonly onProgress?: (progress: BuildProgress) => void;
}

/** What to do with a note, and when it was asked: a note asked again while it is being read is read again. */
interface Work {
  readonly kind: 'embed' | 'forget';
  readonly asked: number;
}

export function createEmbeddingBuild(deps: EmbeddingBuildDeps): EmbeddingBuild {
  const queue = new Map<string, Work>();
  let asked = 0;
  let done = 0;
  let failure: string | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;
  // A resume asked for while a run is under way, which may yet fail: honoured once it ends.
  let resumeAsked = false;

  const progress = (): BuildProgress => ({ done, total: done + queue.size, failure });
  const tell = () => deps.onProgress?.(progress());

  const enqueue = (path: string, kind: Work['kind']) => {
    asked += 1;
    queue.delete(path);
    queue.set(path, { kind, asked });
  };

  const run = async () => {
    try {
      while (!stopped && queue.size > 0) await oneWrite(deps, queue, () => stopped, countDone);
    } catch (cause) {
      failure = messageWithoutPaths(cause);
    } finally {
      running = null;
      if (queue.size === 0) done = 0;
      tell();
      if (resumeAsked) {
        resumeAsked = false;
        failure = null;
        kick();
      }
    }
  };
  const countDone = (count: number) => {
    done += count;
    tell();
  };
  const kick = () => {
    if (stopped || failure !== null || running !== null || queue.size === 0) return;
    running = run();
  };

  return {
    plan(vault) {
      const work = embeddingWork({ vault, cached: deps.blocks.digests() });
      for (const path of work.forget) enqueue(path, 'forget');
      for (const path of work.embed) enqueue(path, 'embed');
      tell();
      kick();
    },
    hear(changes) {
      for (const change of changes) {
        if (change.kind === 'removed' || !isEmbeddableNote(change.path)) {
          if (deps.blocks.note(change.path) !== undefined) enqueue(change.path, 'forget');
        } else if (deps.blocks.note(change.path)?.digest !== change.digest) {
          enqueue(change.path, 'embed');
        }
      }
      tell();
      kick();
    },
    resume() {
      failure = null;
      if (running === null) kick();
      else resumeAsked = true;
    },
    settled: async () => {
      while (running !== null) await running;
    },
    progress,
    stop() {
      stopped = true;
    },
  };
}

/**
 * Takes up to `NOTES_PER_WRITE` notes off the queue — fewer once they need
 * a call's worth of passages — and brings the cache and `blocks` up to them
 * in one write. A note is taken off only once written: stopped or failed
 * before, it is still queued for the next build.
 */
async function oneWrite(
  deps: EmbeddingBuildDeps,
  queue: Map<string, Work>,
  isStopped: () => boolean,
  countDone: (count: number) => void,
): Promise<void> {
  const taken: [string, Work][] = [];
  const forget: string[] = [];
  const read: NotePassages[] = [];
  let passages = 0;
  for (const [path, work] of [...queue]) {
    if (taken.length === NOTES_PER_WRITE || passages >= PASSAGES_PER_CALL) break;
    taken.push([path, work]);
    if (work.kind === 'forget') {
      forget.push(path);
      continue;
    }
    await deps.idle.idle();
    if (isStopped()) return;
    const note = await readNote(deps, path);
    if (note === null) forget.push(path);
    else {
      read.push(note);
      passages += note.chunks.length;
    }
  }
  const notes = await embedded(deps, read);
  if (isStopped()) return;
  await write(deps, { notes, forget });
  // A note asked for again while this write was made stays queued: it changed since it was read.
  for (const [path, work] of taken) if (queue.get(path) === work) queue.delete(path);
  countDone(taken.length);
}

/**
 * The note at `path` as passages; null when it is gone or is not one the
 * cache holds. One that cannot be parsed is held with no passages, so it is
 * not read again until it changes: one torn note must not stop the build.
 */
async function readNote(deps: EmbeddingBuildDeps, path: string): Promise<NotePassages | null> {
  if (!isEmbeddableNote(path)) return null;
  const [file] = await deps.fs.readNotes([path]);
  if (file === undefined) return null;
  try {
    return notePassages(file, deps.markdown);
  } catch {
    // Why it is safe: the note is written with no passages and its digest, and read again once it changes.
    return {
      path,
      digest: digestOf(file.text),
      title: noteTitle(createVaultPath(path)),
      chunks: [],
    };
  }
}

/** Each note with a vector for every chunk, reusing every one the cache already holds. */
async function embedded(
  deps: EmbeddingBuildDeps,
  read: readonly NotePassages[],
): Promise<NoteToCache[]> {
  const known: KnownVectors = new Map();
  for (const note of read)
    for (const block of deps.blocks.note(note.path)?.blocks ?? [])
      known.set(block.digest, block.vector);
  const chunked = read.map((note) => ({ chunks: [...note.chunks] }));
  await embedPassages({ notes: chunked, known, embedder: deps.embedder });
  return read.map((note, at) => ({
    path: note.path,
    digest: note.digest,
    title: note.title,
    blocks: numbered((chunked[at] as { chunks: typeof note.chunks }).chunks).map((chunk) => ({
      ordinal: chunk.ordinal,
      digest: chunk.digest,
      anchor: chunk.anchor,
      heading: chunk.heading,
      excerpt: chunkExcerpt(chunk),
      vector: known.get(chunk.digest) ?? null,
    })),
  }));
}

async function write(
  deps: EmbeddingBuildDeps,
  { notes, forget }: { notes: readonly NoteToCache[]; forget: readonly string[] },
): Promise<void> {
  const scope = { vault: deps.vault };
  if (forget.length > 0) await deps.cache.remove(forget, scope);
  if (notes.length > 0) await deps.cache.put(notes, scope);
  for (const path of forget) deps.blocks.remove(path);
  for (const note of notes) deps.blocks.put(heldNote(note));
}

function heldNote(note: NoteToCache): HeldNote {
  return {
    path: note.path,
    digest: note.digest,
    title: note.title,
    blocks: note.blocks.map((block) => ({
      path: note.path,
      ordinal: block.ordinal,
      digest: block.digest,
      anchor: block.anchor,
      heading: block.heading,
      vector: block.vector,
    })),
  };
}
