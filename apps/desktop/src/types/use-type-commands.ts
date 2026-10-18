import { useCallback } from 'react';
import type { VaultPath } from '@atlas/domain';
import type {
  ActivityLog,
  DefinedType,
  IndexPort,
  MarkdownPort,
  VaultFsPort,
} from '@atlas/application';
import type { OpenEditors } from '../panes/open-editors.ts';
import { useTypeTable } from './use-type-table.ts';
import { useNewType } from './use-new-type.ts';
import { useNewNoteOfType } from './use-new-note-of-type.ts';

/**
 * Everything a type's page needs: its table, what follows a save of the type
 * file, a new type, and a new note of a type.
 */
export function useTypeRoute({
  ports,
  types,
  typeName,
  indexKey,
  notePaths,
  onChanged,
  reloadTypes,
  onTypeCreated,
  onNoteCreated,
}: {
  ports: {
    fs: VaultFsPort;
    markdown: MarkdownPort;
    index: IndexPort;
    editors: OpenEditors;
    activity: Pick<ActivityLog, 'inOpenVault'>;
  };
  types: readonly DefinedType[];
  /** The type whose page is open, or null. */
  typeName: string | null;
  indexKey: string;
  notePaths: readonly string[];
  /** Re-reads the tree and the index, after something wrote to the vault. */
  onChanged: () => void;
  reloadTypes: () => void;
  onTypeCreated: (type: DefinedType) => void;
  onNoteCreated: (path: VaultPath) => void;
}) {
  const { fs, markdown, index, editors, activity } = ports;
  const table = useTypeTable({
    fs,
    markdown,
    index,
    types,
    typeName,
    indexKey,
    onChanged,
    editors,
    activity,
  });

  /** After the type editor writes a type file: the type, the tree and the index follow. */
  const onTypeSaved = useCallback(() => {
    reloadTypes();
    onChanged();
  }, [reloadTypes, onChanged]);

  const newType = useNewType({
    fs,
    markdown,
    types,
    onCreated: (created) => {
      onTypeSaved();
      onTypeCreated(created);
    },
  });

  const newNoteOfType = useNewNoteOfType({
    fs,
    markdown,
    notePaths,
    onCreated: (path) => {
      onChanged();
      onNoteCreated(path);
    },
  });

  return { table, onTypeSaved, newType, newNoteOfType };
}
