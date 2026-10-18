import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  loadObjectTypes,
  type DefinedType,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import { readAgain, vaultReadKey } from '../reads/query-client.ts';

const NO_TYPES: readonly DefinedType[] = [];

/**
 * The vault's type definitions, read once per vault and again when one of
 * them changes (#259). The same answer read twice is the same array, so what
 * hangs off it — the SQL views among them — runs only for a real change.
 * A read that fails is not taken for "no types": it is said (`failure`) and
 * read again when the index next has news.
 */
export function useTypes({
  fs,
  markdown,
  vaultKey,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
}): { types: readonly DefinedType[]; failure: string | null; reload: () => void } {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: vaultReadKey(vaultKey ?? '', 'types'),
    queryFn: () => loadObjectTypes({ fs, markdown }),
    enabled: vaultKey !== null,
  });
  const reload = useCallback(
    () => void readAgain(client, vaultReadKey(vaultKey ?? '', 'types')),
    [client, vaultKey],
  );
  const failure =
    vaultKey === null || error === null
      ? null
      : `The types could not be read: ${error instanceof Error ? error.message : String(error)}`;
  return { types: vaultKey === null ? NO_TYPES : (data ?? NO_TYPES), failure, reload };
}
