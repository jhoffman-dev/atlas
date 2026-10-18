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
 */
export function useTypes({
  fs,
  markdown,
  vaultKey,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
}): { types: readonly DefinedType[]; reload: () => void } {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: vaultReadKey(vaultKey ?? '', 'types'),
    queryFn: () =>
      loadObjectTypes({ fs, markdown }).catch((): DefinedType[] => {
        // No types is a normal state; a failure to read them is not worth
        // stopping the app over.
        return [];
      }),
    enabled: vaultKey !== null,
  });
  const reload = useCallback(
    () => void readAgain(client, vaultReadKey(vaultKey ?? '', 'types')),
    [client, vaultKey],
  );
  return { types: vaultKey === null ? NO_TYPES : (data ?? NO_TYPES), reload };
}
