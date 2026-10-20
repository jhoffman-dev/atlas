import { useCallback } from 'react';
import { createNote, type MarkdownPort, type VaultFsPort } from '@atlas/application';
import type { VaultPath } from '@atlas/domain';
import { localToday } from '../today.ts';

/**
 * "Create '<name>'" from the editor's `[[` (#465): makes a blank note of the
 * name typed, where a new note goes from the note in view (`beside`) — as
 * Obsidian makes the note a link names — without opening it: the link is
 * already written where the person is typing. A note that cannot be made is
 * said through `onProblem`, and the rejection passed on.
 */
export function useCreateLinkedNote({
  fs,
  markdown,
  notePaths,
  beside,
  onChanged,
  onProblem,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  notePaths: readonly VaultPath[];
  beside: VaultPath | null;
  onChanged: () => void;
  onProblem: (message: string) => void;
}): (name: string) => Promise<void> {
  return useCallback(
    async (name: string) => {
      try {
        await createNote({ fs, markdown, today: localToday(), name, beside, notePaths });
        onChanged();
      } catch (cause) {
        const why = cause instanceof Error ? cause.message : String(cause);
        onProblem(`“${name}” could not be made: ${why}`);
        throw cause;
      }
    },
    [fs, markdown, notePaths, beside, onChanged, onProblem],
  );
}
