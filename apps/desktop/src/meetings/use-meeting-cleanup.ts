import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLEANUP_REASON_WORDS,
  createVaultPath,
  noteTitle,
  type CleanupCandidate,
} from '@atlas/domain';
import {
  applyMeetingCleanup,
  previewMeetingCleanup,
  type ActivityRecorder,
  type ArchivePorts,
  type CleanupOwner,
  type MeetingCleanupPorts,
} from '@atlas/application';
import type { MeetingCleanupProps } from '@atlas/ui';
import { localToday } from '../today.ts';

const tasks = (count: number) => (count === 1 ? '1 task' : `${count} tasks`);
const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * The offered cleanup on the Inbox page (#226): the tasks the "After a
 * meeting" rule made that today's rules would not have, read while the page
 * shows, once the owner's name and addresses are known. Nothing moves until
 * the person presses Archive in the preview, and any task they untick stays.
 * The run is said in Activity, with every task it left as it was and why.
 * "Not now" puts the offer away until the vault is opened again.
 */
export function useMeetingCleanup({
  ports,
  owner,
  vaultKey,
  indexReady,
  open,
  activity,
  onChanged,
  onOpenTask,
}: {
  ports: MeetingCleanupPorts & ArchivePorts;
  /** Null until the profile and the owner's addresses have been read: nothing is judged on a stand-in. */
  owner: CleanupOwner | null;
  vaultKey: string | null;
  indexReady: boolean;
  /** Whether the Inbox page is showing: the vault is only read for it. */
  open: boolean;
  activity: ActivityRecorder;
  /** After tasks were archived, so the tree and the index are read again. */
  onChanged: () => void;
  onOpenTask: (path: string) => void;
}): MeetingCleanupProps | null {
  const [listed, setListed] = useState<readonly CleanupCandidate[] | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  // `busy` reaches the panel a render late; a double click would archive twice.
  const running = useRef(false);

  useEffect(() => {
    setListed(null);
    setKept(new Set());
    setExpanded(false);
    setDismissed(false);
    setResult(null);
    setProblem(null);
  }, [vaultKey]);

  useEffect(() => {
    if (!open || !indexReady || vaultKey === null || owner === null || dismissed) return;
    let cancelled = false;
    previewMeetingCleanup({ ports, owner })
      .then((read) => {
        if (!cancelled) setListed(read);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setProblem(`The tasks meetings made could not be read: ${reasonOf(cause)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [ports, owner, open, indexReady, vaultKey, dismissed, revision]);

  const apply = useCallback(() => {
    if (listed === null || owner === null || running.current) return;
    running.current = true;
    setBusy(true);
    setProblem(null);
    applyMeetingCleanup({
      ports,
      owner,
      shown: listed,
      kept: [...kept].map((path) => createVaultPath(path)),
      today: localToday(),
    })
      .then((done) => {
        const left =
          done.failed.length === 0 ? '' : `, ${tasks(done.failed.length)} left as they were`;
        const said = `Archived ${tasks(done.moves.length)} meetings made that weren’t yours${left}.`;
        activity.record({ level: 'info', kind: 'automation', message: said, subject: null });
        for (const { path, reason } of done.failed) {
          activity.record({
            level: 'warning',
            kind: 'automation',
            message: `The cleanup left ${noteTitle(path)} as it was: ${reason}`,
            subject: { kind: 'note', path },
          });
        }
        setResult(said);
        setExpanded(false);
        setKept(new Set());
      })
      .catch((cause: unknown) => {
        const message = `The cleanup stopped: ${reasonOf(cause)}`;
        setProblem(message);
        activity.record({ level: 'error', kind: 'automation', message, subject: null });
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
        setRevision((at) => at + 1);
        onChanged();
      });
  }, [listed, owner, kept, ports, activity, onChanged]);

  const toggle = useCallback((path: string) => {
    setKept((now) => {
      const next = new Set(now);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setExpanded(false);
    setResult(null);
    setProblem(null);
  }, []);

  const offered = !dismissed && listed !== null && listed.length > 0 ? listed : null;
  if (offered === null && result === null && problem === null) return null;
  return {
    tasks:
      offered === null
        ? null
        : offered.map(({ path, title, because }) => ({
            path,
            title,
            why: CLEANUP_REASON_WORDS[because],
          })),
    kept,
    open: expanded,
    busy,
    result,
    problem,
    onOpen: () => setExpanded(true),
    onToggle: toggle,
    onApply: apply,
    onClose: () => setExpanded(false),
    onDismiss: dismiss,
    onOpenTask,
  };
}
