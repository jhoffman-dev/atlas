import { useCallback } from 'react';
import {
  createRelatedNote,
  type DefinedType,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import type { VaultPath } from '@atlas/domain';
import type { CreateRelated } from '@atlas/ui';

/**
 * "New company…" in a relation's picker, for the note at `beside`: makes the
 * note through `createRelatedNote` and answers with the link the relation
 * writes. A type the vault no longer defines is refused in so many words.
 */
export function useCreateRelated({
  fs,
  markdown,
  types,
  notePaths,
  beside,
  onChanged,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  types: readonly DefinedType[];
  notePaths: readonly VaultPath[];
  beside: VaultPath | null;
  onChanged: () => void;
}): CreateRelated {
  return useCallback(
    async ({ target, name }) => {
      const type = types.find((known) => known.name === target);
      if (type === undefined) throw new Error(`There is no ${target} type to make one of.`);
      const made = await createRelatedNote({
        fs,
        markdown,
        type,
        name,
        beside,
        notePaths,
      });
      onChanged();
      return `[[${made.target}]]`;
    },
    [fs, markdown, types, notePaths, beside, onChanged],
  );
}
