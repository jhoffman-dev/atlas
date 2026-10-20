import { useMemo, useRef } from 'react';
import { createNote, type MarkdownPort, type VaultFsPort } from '@atlas/application';
import {
  createVaultPath,
  createWikiLinkResolver,
  noteFileName,
  noteTitle,
  wikiLinkTargetFor,
  type VaultPath,
} from '@atlas/domain';
import type { LinkedNoteMaker } from '@atlas/ui';
import { localToday } from '../today.ts';

/**
 * "Create '<name>'" from the editor's `[[` (#465): makes a blank note of the
 * name typed, where a new note goes from the note in view (`beside`) — as
 * Obsidian makes the note a link names — without opening it, and answers
 * with the link to the note as made: its name cleaned of what a file name
 * cannot hold (`Q3: plan` is `Q3 plan`), or numbered. A note that cannot be
 * made is said through `onProblem`, and the rejection passed on.
 *
 * `named` says which names are taken, so "Create" is offered for none of
 * them: any note's — archived ones too, whose links a new note of that name
 * would take over — by the name typed or the one its file would get, and
 * any being made, until the vault's notes list it.
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
}): LinkedNoteMaker {
  /** The names being made, folded as links fold them, by the path each will take. */
  const making = useRef(new Map<string, VaultPath | null>());
  return useMemo(() => {
    const opens = createWikiLinkResolver(notePaths);
    const fileTitle = (name: string) => noteTitle(createVaultPath(noteFileName(name)));
    const key = (name: string) => fileTitle(name).toLowerCase();
    const listed = new Set(notePaths);
    /** Whether a name is being made: one the vault's notes now list is not, any more. */
    const beingMade = (name: string) => {
      const path = making.current.get(key(name));
      if (path === undefined) return false;
      if (path === null || !listed.has(path)) return true;
      making.current.delete(key(name));
      return false;
    };
    return {
      named: (name) => {
        // Asked first, so a note the vault now lists is let go of even when it answers below.
        const pending = beingMade(name);
        return pending || opens(name) !== null || opens(fileTitle(name)) !== null;
      },
      make: async (name) => {
        making.current.set(key(name), null);
        try {
          const path = await createNote({
            fs,
            markdown,
            today: localToday(),
            name,
            beside,
            notePaths,
          });
          making.current.set(key(name), path);
          onChanged();
          return wikiLinkTargetFor(path, [...notePaths, path]);
        } catch (cause) {
          making.current.delete(key(name));
          const why = cause instanceof Error ? cause.message : String(cause);
          onProblem(`“${name}” could not be made: ${why}`);
          throw cause;
        }
      },
    };
  }, [fs, markdown, notePaths, beside, onChanged, onProblem]);
}
