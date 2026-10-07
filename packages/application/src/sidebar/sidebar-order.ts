import { parseSectionOrder, SIDEBAR_ORDER_KEY, type SidebarSectionId } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * The order the sidebar's sections were put in, as the vault's settings list
 * it; null when it was never set. In the vault rather than the browser, so the
 * sidebar looks the same wherever the vault is opened.
 */
export async function loadSidebarOrder(args: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<readonly SidebarSectionId[] | null> {
  const settings = await readVaultSettings(args);
  return parseSectionOrder(settings[SIDEBAR_ORDER_KEY]);
}

/** Writes the sidebar's section order into the vault's settings. */
export async function saveSidebarOrder({
  settings,
  order,
}: {
  settings: SettingsWriter;
  order: readonly SidebarSectionId[];
}): Promise<void> {
  await settings.save({ [SIDEBAR_ORDER_KEY]: [...order] });
}
