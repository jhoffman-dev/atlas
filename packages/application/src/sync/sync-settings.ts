import {
  AUTOMATIONS_MAC_KEY,
  AUTOMATIONS_MAC_NAME_KEY,
  automationsMacOf,
  pullIntervalMinutes,
  pushDelaySeconds,
  SYNC_INTERVAL_KEY,
  SYNC_PUSH_DELAY_KEY,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What a synced vault's settings note says about syncing, the same on every Mac. */
export interface SyncSettings {
  /** How often to look for other Macs' changes. */
  readonly pullIntervalMinutes: number;
  /** How long after the last change to send it. */
  readonly pushDelaySeconds: number;
  /** The Mac that runs the automations, by its id; null when none is named. */
  readonly automationsMac: string | null;
  /** That Mac's name when it was named, to show. */
  readonly automationsMacName: string | null;
}

export async function loadSyncSettings(args: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<SyncSettings> {
  const settings = await readVaultSettings(args);
  return {
    pullIntervalMinutes: pullIntervalMinutes(settings[SYNC_INTERVAL_KEY]),
    pushDelaySeconds: pushDelaySeconds(settings[SYNC_PUSH_DELAY_KEY]),
    automationsMac: automationsMacOf(settings[AUTOMATIONS_MAC_KEY]),
    automationsMacName: automationsMacOf(settings[AUTOMATIONS_MAC_NAME_KEY]),
  };
}

export async function saveSyncSettings({
  settings,
  changes,
}: {
  settings: SettingsWriter;
  changes: Partial<SyncSettings>;
}): Promise<void> {
  await settings.save({
    ...(changes.pullIntervalMinutes !== undefined && {
      [SYNC_INTERVAL_KEY]: pullIntervalMinutes(changes.pullIntervalMinutes),
    }),
    ...(changes.pushDelaySeconds !== undefined && {
      [SYNC_PUSH_DELAY_KEY]: pushDelaySeconds(changes.pushDelaySeconds),
    }),
    ...(changes.automationsMac !== undefined && { [AUTOMATIONS_MAC_KEY]: changes.automationsMac }),
    ...(changes.automationsMacName !== undefined && {
      [AUTOMATIONS_MAC_NAME_KEY]: changes.automationsMacName,
    }),
  });
}
