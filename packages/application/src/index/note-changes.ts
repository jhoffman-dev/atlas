import type { NoteChange } from '@atlas/domain';

/** The notes one sync of the index found added, changed or removed in a vault. */
export interface NoteChangeNews {
  /** The vault they happened in, which may no longer be the one open by the time it is heard. */
  readonly vault: string;
  readonly changes: readonly NoteChange[];
}

/**
 * Where everything that reacts to a note arriving or changing hears of it
 * (P28-03). Every sync of the index publishes here — after a typed edit, an
 * API write, a change the watcher saw or a sync pull alike — because each of
 * them ends in one; a sync that found nothing publishes nothing.
 */
export interface NoteChanges {
  publish(news: NoteChangeNews): void;
  /** Handed each sync's changes from now on; returns the way to stop. */
  subscribe(listener: (news: NoteChangeNews) => void): () => void;
}

export function createNoteChanges({
  onError,
}: {
  /** Told of a listener that threw, which the others and the sync must not be. */
  onError: (cause: unknown) => void;
}): NoteChanges {
  const listeners = new Set<(news: NoteChangeNews) => void>();
  return {
    publish(news) {
      for (const listener of listeners) {
        try {
          listener(news);
        } catch (cause) {
          // One listener's failure must not keep the news from the others, nor fail the sync.
          onError(cause);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
