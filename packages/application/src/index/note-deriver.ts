import { createWikiLinkResolver, messageWithoutPaths, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { NoteFile } from '../vault/ports.ts';
import type { IndexedNote } from './ports.ts';
import { toIndexedNote } from './to-indexed-note.ts';

/** A note that could not be read as one, and why. */
export interface UnreadNote {
  readonly path: string;
  readonly problem: string;
}

/** What a batch of note files came to: the rows of each that could be read, and the rest. */
export interface NoteDerivation {
  readonly notes: readonly IndexedNote[];
  readonly failed: readonly UnreadNote[];
}

/** One build's worth of deriving: every batch is resolved against the same notes. */
export interface NoteDeriving {
  derive(files: readonly NoteFile[]): Promise<NoteDerivation>;
  /** The build is over, finished or not; nothing more will be asked of it. */
  end(): void;
}

/**
 * Turns note files into what the index holds of them: the rules of
 * `toIndexedNote`, run wherever the implementation runs them (#135). Reading
 * a vault's notes is seconds of work, and the window's thread is no place for
 * it; the rules stay these, in TypeScript, whichever thread they run on
 * (ADR-0005).
 */
export interface NoteDeriver {
  /** Starts a build over a vault holding these notes, which links resolve against. */
  begin(notePaths: readonly VaultPath[]): NoteDeriving;
}

/**
 * Reads each file into its rows. One that cannot be read is said, with why,
 * and the others are still read: one torn note must not cost the vault its index.
 */
export function deriveNotes({
  files,
  notePaths,
  markdown,
  resolveLink,
}: {
  files: readonly NoteFile[];
  notePaths: readonly VaultPath[];
  markdown: MarkdownPort;
  resolveLink: (target: string) => VaultPath | null;
}): NoteDerivation {
  const notes: IndexedNote[] = [];
  const failed: UnreadNote[] = [];
  for (const file of files) {
    try {
      notes.push(toIndexedNote({ file, notePaths, markdown, resolveLink }));
    } catch (cause) {
      failed.push({ path: file.path, problem: messageWithoutPaths(cause) });
    }
  }
  return { notes, failed };
}

/**
 * Derives on the calling thread. What a worker runs on its own thread, and
 * what a refresh falls back on when it is handed no deriver — a test, or a
 * caller with a handful of notes.
 */
export function inThreadNoteDeriver(markdown: MarkdownPort): NoteDeriver {
  return {
    begin(notePaths) {
      // One resolver for the whole build: every link in every note asks it.
      const resolveLink = createWikiLinkResolver(notePaths);
      return {
        derive: async (files) => deriveNotes({ files, notePaths, markdown, resolveLink }),
        end: () => {},
      };
    },
  };
}
