import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVaultPath,
  FILED_UNDER_TYPES,
  filingRefusal,
  noteTitle,
  PERSON_TYPE,
  tasksStartInInbox,
  waitingOnRefusal,
  type Clarification,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import {
  clarifyInboxItem,
  ClarifyRefusedError,
  listInbox,
  notesInUseOfTypes,
  undoClarifyInboxItem,
  type ActivityLog,
  type ArchivePorts,
  type ClarifyOutcome,
  type ClarifyUndo,
  type Clock,
} from '@atlas/application';
import type { InboxContents, RelationChoice } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import { errorMessage } from '../query/error-message.ts';

export interface InboxOptions {
  readonly ports: ArchivePorts;
  readonly notePaths: readonly VaultPath[];
  /** The vault that is open, which everything the page shows is read from; null with none. */
  readonly vaultKey: string | null;
  /** The vault's types: once its tasks start in the Inbox, a status is what clarifies one. */
  readonly types: readonly ObjectType[];
  readonly clock: Pick<Clock, 'today'>;
  /** Changes when the index does, so the Inbox lists what it now holds. */
  readonly indexKey: string;
  /** Whether the index is ready to be asked; while it builds, nothing is read or shown. Ready unless said. */
  readonly indexReady?: boolean;
  /** Whether the Inbox page is showing, which is when what to file under is read. */
  readonly open: boolean;
  /** Re-reads the tree and the index once a note has been clarified. */
  readonly onSettled: () => void;
  /** Where a write the page gives up on is recorded; a refusal is not. */
  readonly activity: Pick<ActivityLog, 'inOpenVault'>;
}

/** What the row says once a note is clarified: only what could not be done. */
function outcomeProblem(outcome: ClarifyOutcome): string | null {
  if (outcome.failed.length === 0) return null;
  return outcome.failed.map(({ path, reason }) => `${noteTitle(path)}: ${reason}`).join(' ');
}

/**
 * The Inbox page (P30-01, #112): what waits — the `Inbox` folder's notes and
 * every task still at Inbox — what a note can be filed under and who a task
 * can wait on, clarifying a row, and taking the last one back. The rules are
 * the use-cases'; this holds what is on screen.
 *
 * The list is read whatever page is open, so the sidebar's count is right;
 * the projects, areas and people only while the page shows. Everything shown
 * is what the open vault's index answered (#55): after a vault switch the
 * last read's paths are another vault's, so neither they nor their actions
 * are offered until this one's read is in. While the same vault's index
 * re-reads, what it last answered stays up, and so does what a row holds.
 */
export function useInbox(options: InboxOptions) {
  const { ports, notePaths, vaultKey, types, clock, indexKey, open, onSettled, activity } = options;
  const settled = useIndexMovedOn({ vaultKey, indexKey });
  // Asked only while it is ready; what it last answered for this vault stays up while it re-reads.
  const fresh = settled && (options.indexReady ?? true);
  const [listing, setListing] = useState<Listing | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` reaches the page a render late; two picks in one tick would both see it false.
  const running = useRef(false);
  const startInInbox = tasksStartInInbox(types);

  useEffect(() => {
    if (!fresh) return;
    let cancelled = false;
    listInbox({ index: ports.index, tasksStartInInbox: startInInbox })
      .then((contents) => {
        if (!cancelled) setListing({ vaultKey, contents, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setListing({ vaultKey, contents: null, error: errorMessage(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [ports.index, indexKey, fresh, vaultKey, startInInbox]);

  useEffect(() => {
    if (!open || !fresh) return;
    let cancelled = false;
    readChoices(ports.index)
      .then((found) => {
        if (!cancelled) setChoices({ vaultKey, ...found, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setChoices({ vaultKey, filing: [], people: [], error: errorMessage(cause) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ports.index, indexKey, fresh, vaultKey, open]);

  const shown = settled && listing?.vaultKey === vaultKey ? listing : null;
  const offered = settled && choices?.vaultKey === vaultKey ? choices : null;
  const told = said?.vaultKey === vaultKey ? said : null;

  /** Runs one write at a time, against the vault that was open when it was asked for. */
  const act = useCallback(
    async (action: () => Promise<Result>): Promise<boolean> => {
      if (running.current || !settled) return false;
      running.current = true;
      setBusy(true);
      try {
        const result = await action();
        // A refused pick leaves the last action as it was: it can still be taken back.
        setSaid((before) => ({
          vaultKey,
          ...result,
          last:
            result.last === 'kept'
              ? before?.vaultKey === vaultKey
                ? before.last
                : null
              : result.last,
        }));
        return result.refusal === null && result.problem === null;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [settled, vaultKey],
  );

  const clarify = useCallback(
    ({ path, clarification }: { path: VaultPath; clarification: Clarification }) =>
      act(async () => {
        const write = clarification.project === undefined ? 'edit' : 'filing';
        const named = { activity, write, path, refusal: ClarifyRefusedError } as const;
        try {
          const outcome = await withGiveUpRecorded(named, () =>
            clarifyInboxItem({ ports, path, clarification, notePaths, today: clock.today() }),
          );
          onSettled();
          const reason = outcomeProblem(outcome);
          return {
            problem: null,
            refusal: reason === null ? null : { path, reason },
            last: { title: noteTitle(path), undo: outcome.undo },
          };
        } catch (cause) {
          return { problem: null, refusal: { path, reason: errorMessage(cause) }, last: 'kept' };
        }
      }),
    [act, activity, clock, notePaths, onSettled, ports],
  );

  const last = told?.last ?? null;
  const undo = useCallback(
    () =>
      act(async () => {
        if (last === null) return { problem: null, refusal: null, last: null };
        const path = last.undo.to;
        const named = { activity, write: 'edit', path, refusal: ClarifyRefusedError } as const;
        try {
          await withGiveUpRecorded(named, () =>
            undoClarifyInboxItem({ ports, undo: last.undo, notePaths }),
          );
          onSettled();
          return { problem: null, refusal: null, last: null };
        } catch (cause) {
          return { problem: errorMessage(cause), refusal: null, last: 'kept' };
        }
      }),
    [act, activity, last, notePaths, onSettled, ports],
  );

  return {
    contents: shown?.contents ?? null,
    error: shown?.error ?? offered?.error ?? null,
    filing: offered?.filing ?? NONE,
    people: offered?.people ?? NONE,
    busy,
    /** Why the last undo could not be done, or null. */
    problem: told?.problem ?? null,
    /** Why the last clarification was refused or left unfinished, and the row it was for. */
    refusal: told?.refusal ?? null,
    /** The last clarification, while it can be taken back. */
    lastAction: last === null ? null : { title: last.title },
    clarify,
    undo,
  };
}

const NONE: readonly RelationChoice[] = [];

/** A read of the Inbox, and the vault it was read from. */
interface Listing {
  readonly vaultKey: string | null;
  readonly contents: InboxContents | null;
  readonly error: string | null;
}

/** What a row can be filed under and who it can wait on, and the vault they are in. */
interface Choices {
  readonly vaultKey: string | null;
  readonly filing: readonly RelationChoice[];
  readonly people: readonly RelationChoice[];
  readonly error: string | null;
}

/** What the last action left to say, and the vault it was said of. */
interface Said {
  readonly vaultKey: string | null;
  readonly problem: string | null;
  readonly refusal: { readonly path: VaultPath; readonly reason: string } | null;
  readonly last: { readonly title: string; readonly undo: ClarifyUndo } | null;
}

/** What an action leaves to say; `kept` leaves the last clarification to take back as it was. */
type Result = Omit<Said, 'vaultKey' | 'last'> & { readonly last: Said['last'] | 'kept' };

/** Only what clarifying would accept: never a project still in the Inbox, or an archived person. */
async function readChoices(
  index: ArchivePorts['index'],
): Promise<Pick<Choices, 'filing' | 'people'>> {
  const [projects, people] = await Promise.all([
    notesInUseOfTypes({ index, types: FILED_UNDER_TYPES }),
    notesInUseOfTypes({ index, types: [PERSON_TYPE] }),
  ]);
  const at = (note: { path: string }) => createVaultPath(note.path);
  return {
    filing: projects.filter((note) => filingRefusal({ path: at(note), type: note.type }) === null),
    people: people.filter((note) => waitingOnRefusal({ path: at(note), type: note.type }) === null),
  };
}

/**
 * Whether the index has moved on to the vault that is open. It starts on a
 * vault a render after that vault opens, so for that render it still says
 * `ready` with the last vault's rows: the key it had then is remembered, and
 * nothing is read, shown or written until it has changed.
 */
function useIndexMovedOn({
  vaultKey,
  indexKey,
}: {
  vaultKey: string | null;
  indexKey: string;
}): boolean {
  const [opened, setOpened] = useState({ vaultKey, staleIndexKey: null as string | null });
  if (opened.vaultKey !== vaultKey) {
    setOpened({ vaultKey, staleIndexKey: indexKey });
    return false;
  }
  return indexKey !== opened.staleIndexKey;
}
