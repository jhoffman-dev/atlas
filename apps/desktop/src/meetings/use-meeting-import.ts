import { useEffect, useRef } from 'react';
import {
  createMeetingImporter,
  importMeetingsOnArrival,
  type ActivityLog,
  type Clock,
  type MeetingImportPorts,
  type NoteChanges,
} from '@atlas/application';

/**
 * Imports meetings as they arrive (P28-04): every refresh of the index says
 * which notes it found, and the meeting files among them are checked,
 * deduplicated and marked. The rules are the use-case's; this only connects
 * it to the window's change feed.
 *
 * One importer for the window, so its queue and what it has heard (which it
 * keeps per vault) are not lost. The ports, the open vault and what to do after
 * a write change far more often — the ports on every folder opened or closed —
 * and are read as each run starts instead.
 */
export function useMeetingImport({
  changes,
  ports,
  clock,
  activity,
  vaultKey,
  onWritten,
}: {
  changes: NoteChanges;
  ports: MeetingImportPorts;
  clock: Pick<Clock, 'today'>;
  activity: ActivityLog;
  vaultKey: string | null;
  /** Re-reads the tree and the index once the import has written or moved a note. */
  onWritten: () => void;
}): void {
  // News of a vault no longer open is dropped by the importer, which asks this.
  const latest = useRef({ ports, onWritten, vaultKey });
  latest.current = { ports, onWritten, vaultKey };

  useEffect(() => {
    const importer = createMeetingImporter({
      ports: () => latest.current.ports,
      clock,
      activity,
      openVault: () => latest.current.vaultKey,
      onWritten: () => latest.current.onWritten(),
    });
    return importMeetingsOnArrival({ changes, importer, activity });
  }, [changes, clock, activity]);
}
