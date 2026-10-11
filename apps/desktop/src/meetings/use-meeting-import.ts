import { useEffect, useRef, useState } from 'react';
import {
  createMeetingImporter,
  importMeetingsOnArrival,
  type ActivityLog,
  type Clock,
  type MeetingImportPorts,
  type NoteChanges,
} from '@atlas/application';

/**
 * Imports meetings (P28-04): every refresh of the index says which notes it
 * found, and the meeting files among them are settled; and once the index is
 * ready, every meeting file not settled yet is. The rules are the
 * use-case's; this connects them to the window.
 *
 * Only on the Mac that runs the vault's automations (`active`), so two Macs
 * never write the same file. It catches up when the vault opens there, and
 * when this Mac takes the automations over.
 *
 * One importer for the window, so its queue is not lost. The ports, the open
 * vault, `active` and what to do after a write change more often — the ports
 * on every folder opened or closed — and are read as each run starts.
 */
export function useMeetingImport({
  changes,
  ports,
  clock,
  activity,
  vaultKey,
  active,
  indexReady,
  onWritten,
}: {
  changes: NoteChanges;
  ports: MeetingImportPorts;
  clock: Pick<Clock, 'today'>;
  activity: ActivityLog;
  vaultKey: string | null;
  /** Whether this Mac imports: it runs the vault's automations. */
  active: boolean;
  /**
   * Whether the index is ready, which the import asks who holds a meeting.
   * Only a ready seen after the vault opened counts: the window's status is
   * the last vault's until the new one's sync starts.
   */
  indexReady: boolean;
  /** Re-reads the tree and the index once the import has written or moved a note. */
  onWritten: () => void;
}): void {
  const latest = useRef({ ports, onWritten, vaultKey, active });
  latest.current = { ports, onWritten, vaultKey, active };
  const [importer, setImporter] = useState<ReturnType<typeof createMeetingImporter> | null>(null);

  useEffect(() => {
    const made = createMeetingImporter({
      ports: () => latest.current.ports,
      clock,
      activity,
      openVault: () => latest.current.vaultKey,
      active: () => latest.current.active,
      onWritten: () => latest.current.onWritten(),
    });
    setImporter(made);
    return importMeetingsOnArrival({ changes, importer: made });
  }, [changes, clock, activity]);

  // The index's status is the last vault's until the new vault's sync starts,
  // so a ready status counts for this vault only once it has been seen not
  // ready since the vault opened.
  const readyFor = useRef<{ vault: string | null; seenWorking: boolean }>({
    vault: null,
    seenWorking: false,
  });
  if (readyFor.current.vault !== vaultKey)
    readyFor.current = { vault: vaultKey, seenWorking: false };
  if (!indexReady) readyFor.current.seenWorking = true;
  const readyHere = indexReady && readyFor.current.seenWorking;

  // Once per vault, per spell as the importing Mac, once its index is ready.
  const caughtUp = useRef<string | null>(null);
  useEffect(() => {
    if (!active || vaultKey === null) caughtUp.current = null;
    if (importer === null || !active || !readyHere || vaultKey === null) return;
    if (caughtUp.current === vaultKey) return;
    caughtUp.current = vaultKey;
    void importer.catchUp(vaultKey);
  }, [importer, active, readyHere, vaultKey]);
}
