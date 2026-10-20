import { parseQuickAdd, QUICK_ADD_KEY } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** The types quick add offers, as the vault's settings list them; null when unset. */
export async function loadQuickAddSetting(args: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<readonly string[] | null> {
  return quickAddOf(await readVaultSettings(args));
}

/** The types quick add offers in settings already read; null when unset. */
export function quickAddOf(settings: Readonly<Record<string, unknown>>): readonly string[] | null {
  return parseQuickAdd(settings[QUICK_ADD_KEY]);
}

/** Writes quick add's types into the vault's settings. */
export async function saveQuickAddSetting({
  settings,
  types,
}: {
  settings: SettingsWriter;
  types: readonly string[];
}): Promise<void> {
  await settings.save({ [QUICK_ADD_KEY]: [...types] });
}
