import { parseQuickAdd, QUICK_ADD_KEY } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** The types the add button offers, as the vault's settings list them; null when unset. */
export async function loadQuickAddSetting(args: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<readonly string[] | null> {
  const settings = await readVaultSettings(args);
  return parseQuickAdd(settings[QUICK_ADD_KEY]);
}

/** Writes the add button's types into the vault's settings. */
export async function saveQuickAddSetting({
  settings,
  types,
}: {
  settings: SettingsWriter;
  types: readonly string[];
}): Promise<void> {
  await settings.save({ [QUICK_ADD_KEY]: [...types] });
}
