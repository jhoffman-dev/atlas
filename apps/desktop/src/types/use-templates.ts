import { useCallback, useEffect, useState } from 'react';
import {
  loadTemplates,
  readTemplate,
  type NoteTemplate,
  type VaultFsPort,
} from '@atlas/application';

/** The templates the vault offers, reloaded when its files change. */
export function useTemplates({
  fs,
  vaultKey,
  changeKey,
}: {
  fs: VaultFsPort;
  vaultKey: string | null;
  changeKey: string;
}): {
  templates: readonly NoteTemplate[];
  contentsOf: (template: NoteTemplate) => Promise<string>;
} {
  const [templates, setTemplates] = useState<readonly NoteTemplate[]>([]);

  useEffect(() => {
    if (vaultKey === null) {
      setTemplates([]);
      return;
    }
    loadTemplates({ fs })
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [fs, vaultKey, changeKey]);

  return {
    templates,
    contentsOf: useCallback((template) => readTemplate({ fs, template }), [fs]),
  };
}
