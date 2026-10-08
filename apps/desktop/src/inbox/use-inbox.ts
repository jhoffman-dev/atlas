import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVaultPath,
  FILED_UNDER_TYPES,
  filingRefusal,
  noteTitle,
  type VaultPath,
} from '@atlas/domain';
import {
  listInbox,
  notesInUseOfTypes,
  processInboxItems,
  type ArchiveOutcome,
  type ArchivePorts,
} from '@atlas/application';
import type { InboxContents, RelationChoice } from '@atlas/ui';

export interface InboxOptions {
  readonly ports: ArchivePorts;
  readonly notePaths: readonly VaultPath[];
  /** Changes when the index does, so the Inbox lists what it now holds. */
  readonly indexKey: string;
  /** Whether the Inbox page is showing, which is when what to file under is read. */
  readonly open: boolean;
  /** Re-reads the tree and the index once a note has been filed. */
  readonly onSettled: () => void;
}

/** What the window says once a note is filed: only what could not be done. */
function outcomeProblem(outcome: ArchiveOutcome): string | null {
  if (outcome.failed.length === 0) return null;
  return outcome.failed.map(({ path, reason }) => `${noteTitle(path)}: ${reason}`).join(' ');
}

/**
 * The Inbox page: what waits in the `Inbox` folder, what it can be filed
 * under, and filing a note there (P30-01). The rules are the use-cases'; this
 * holds what is on screen.
 *
 * The list is read whatever page is open, so the sidebar's count is right;
 * the projects and areas only while the page shows.
 */
export function useInbox({ ports, notePaths, indexKey, open, onSettled }: InboxOptions) {
  const [contents, setContents] = useState<InboxContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState<readonly RelationChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // `busy` reaches the page a render late; two picks in one tick would both see it false.
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listInbox({ index: ports.index })
      .then((listing) => {
        if (cancelled) return;
        setContents(listing);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [ports.index, indexKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    notesInUseOfTypes({ index: ports.index, types: FILED_UNDER_TYPES })
      .then((found) => {
        // Only what Process would accept: never a project still in the Inbox, or one filed too deep.
        const offered = found.filter(
          (note) => filingRefusal({ path: createVaultPath(note.path), type: note.type }) === null,
        );
        if (!cancelled) setFiling(offered);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [ports.index, indexKey, open]);

  const process = useCallback(
    async ({ path, project }: { path: VaultPath; project: VaultPath }) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setProblem(null);
      try {
        const outcome = await processInboxItems({
          ports,
          paths: [path],
          notePaths,
          project,
          updateLinks: true,
        });
        setProblem(outcomeProblem(outcome));
        onSettled();
      } catch (cause) {
        setProblem(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [ports, notePaths, onSettled],
  );

  return { contents, error, filing, busy, problem, process };
}
