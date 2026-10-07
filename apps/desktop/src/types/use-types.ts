import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadObjectTypes,
  type DefinedType,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';

/** The vault's type definitions, reloaded when the vault or its files change. */
export function useTypes({
  fs,
  markdown,
  vaultKey,
  changeKey,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
  /** Changes when the vault's files do, so a new type shows up without a restart. */
  changeKey: string;
}): { types: readonly DefinedType[]; reload: () => void } {
  const [types, setTypes] = useState<readonly DefinedType[]>([]);
  // Loads overlap when a type is saved and the index then moves on, and they
  // can finish out of order. Only the latest may land: an older one would put
  // back a type as it was before the save.
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const ticket = latest.current;
    const settle = (found: readonly DefinedType[]) => {
      if (ticket === latest.current) setTypes(found);
    };
    if (vaultKey === null) {
      settle([]);
      return;
    }
    loadObjectTypes({ fs, markdown })
      .then(settle)
      .catch(() => {
        // No types is a normal state; a failure to read them is not worth
        // stopping the app over.
        settle([]);
      });
  }, [fs, markdown, vaultKey]);

  useEffect(load, [load, changeKey]);

  return { types, reload: load };
}
