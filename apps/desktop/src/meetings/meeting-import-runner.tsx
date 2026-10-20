import { memo } from 'react';
import { useSyncForRunners, type SyncStore } from '../sync/sync-store.ts';
import { useMeetingImport } from './use-meeting-import.ts';

export type MeetingImportRunnerProps = Omit<
  Parameters<typeof useMeetingImport>[0],
  'active' | 'pulledFiles'
> & {
  /** Where sync says whether this Mac runs the vault's automations, and what a pull brought in. */
  readonly sync: SyncStore;
};

/**
 * Runs the meeting import (P28-04) outside the window (#326). Only the Mac
 * that runs the automations writes into meeting files (U-29), and only on
 * fresh sync state (ADR-0035 part 4): both are read from the sync store here,
 * so the window is not drawn when they change.
 */
export const MeetingImportRunner = memo(function MeetingImportRunner({
  sync,
  ...options
}: MeetingImportRunnerProps) {
  const { automationsHere, pulledFiles } = useSyncForRunners(sync, options.vaultKey);
  useMeetingImport({ ...options, active: automationsHere, pulledFiles });
  return null;
});
