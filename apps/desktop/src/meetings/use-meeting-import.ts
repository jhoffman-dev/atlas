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
 * it to the window's change feed for as long as the ports stay the same.
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
  // Read by the importer at each run, so news of a vault closed since is dropped.
  const open = useRef(vaultKey);
  open.current = vaultKey;

  useEffect(() => {
    const importer = createMeetingImporter({
      ports,
      clock,
      activity,
      openVault: () => open.current,
      onWritten,
    });
    return importMeetingsOnArrival({ changes, importer, activity });
  }, [changes, ports, clock, activity, onWritten]);
}
