import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clarifyVocabulary,
  createVaultPath,
  FILED_UNDER_TYPES,
  filingRefusal,
  noteTitle,
  PERSON_TYPE,
  tasksStartInInbox,
  waitingOnRefusal,
  type Clarification,
  type EntryMove,
  type InboxKey,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import {
  clarifyInboxItem,
  ClarifyRefusedError,
  listInbox,
  listInboxThrough,
  notesInUseOfTypes,
  undoClarifyInboxItem,
  type ActivityLog,
  type ArchivePorts,
  type ClarifyOutcome,
  type ClarifyUndo,
  type Clock,
  type InboxListing,
  type WindowClosingPort,
} from '@atlas/application';
import type { RelationChoice } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import { useAnswerQueue, useAnswersWrittenBeforeClose } from '../proposals/answer-queue.ts';
import { errorMessage } from '../query/error-message.ts';
import { withoutLeaving, type LeavingRow, type ReadMoment } from './leaving-rows.ts';
import { keptWhereSame } from './kept-where-same.ts';
import { notesAfterOwnMoves } from './own-moves.ts';

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
  /** Re-reads the tree and the index once the clarifications asked for are all written. */
  readonly onSettled: () => void;
  /** Where a write the page gives up on is recorded; a refusal is not. */
  readonly activity: Pick<ActivityLog, 'inOpenVault'>;
  /** The window's close, held until the clarifications still being written are written. */
  readonly closing: WindowClosingPort;
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
 * A clarified row leaves the list at once and is written in the background,
 * after any still being written (#217), so the next row can be worked
 * straight away. One that fails comes back with why. The tree and the index
 * are read again once every clarification asked for is written — not once
 * for each — and a row that left stays off the list until a read of the
 * index that has caught up with its write lands.
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
  const [choices, setChoices] = useState<Choices | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [undoing, setUndoing] = useState(0);
  const { actions: writes, leaving } = useClarifyWrites({
    onSettled,
    closing: options.closing,
    notePaths,
    indexKey,
  });
  const startInInbox = tasksStartInInbox(types);
  const { listing, showMore } = useInboxListing({
    index: ports.index,
    vaultKey,
    indexKey,
    fresh,
    tasksStartInInbox: startInInbox,
    moment: writes.moment,
  });

  useEffect(() => {
    if (!open || !fresh) return;
    let cancelled = false;
    readChoices(ports.index)
      .then((found) => {
        if (cancelled) return;
        // The same projects and people as last time are the same lists, so no row is drawn again for them.
        setChoices((before) => {
          const same = before?.vaultKey === vaultKey ? before : null;
          return {
            vaultKey,
            filing: keptWhereSame(same?.filing ?? null, found.filing, byPath),
            people: keptWhereSame(same?.people ?? null, found.people, byPath),
            error: null,
          };
        });
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
  const contents = useMemo(
    () =>
      shown?.contents === null || shown?.contents === undefined
        ? null
        : withoutLeaving(
            shown.contents,
            leaving.vaultKey === vaultKey ? leaving.rows : NO_ROWS,
            shown.read,
          ),
    [shown, leaving, vaultKey],
  );

  /** Says what a write left, of the vault it was asked in; `kept` leaves the last action to take back. */
  const say = useCallback(
    (asked: string | null, result: Result) =>
      setSaid((before) => ({
        vaultKey: asked,
        ...result,
        last:
          result.last === 'kept' ? (before?.vaultKey === asked ? before.last : null) : result.last,
      })),
    [],
  );

  const clarify = useCallback(
    ({ path, clarification }: { path: VaultPath; clarification: Clarification }) => {
      if (!settled) return Promise.resolve(false);
      // Made a task, a note stays in the Inbox, on a row of its own; anything else leaves it.
      const leaves = clarification.asTask !== true;
      const asked = vaultKey;
      if (leaves) writes.leave(asked, path);
      const write = clarification.project === undefined ? 'edit' : 'filing';
      const named = { activity: logOfVaultOpenNow(activity), write, path } as const;
      return writes.enqueue(ports, async (paths) => {
        try {
          const outcome = await withGiveUpRecorded({ ...named, refusal: ClarifyRefusedError }, () =>
            clarifyInboxItem({
              ports,
              path,
              clarification,
              notePaths: paths,
              today: clock.today(),
            }),
          );
          const reason = outcomeProblem(outcome);
          // Clarified but not filed — the move refused, say — the row comes back to say why.
          if (reason === null && leaves) writes.written(asked, path);
          else writes.stay(asked, path);
          say(asked, {
            problem: null,
            refusal: reason === null ? null : { path, reason },
            last: { title: noteTitle(path), undo: outcome.undo },
          });
          return { done: reason === null, wrote: true, moved: movedBy(outcome) };
        } catch (cause) {
          writes.stay(asked, path);
          say(asked, {
            problem: null,
            refusal: { path, reason: errorMessage(cause) },
            last: 'kept',
          });
          return { done: false, wrote: false, moved: null };
        }
      });
    },
    [settled, vaultKey, writes, activity, ports, clock, say],
  );

  const last = told?.last ?? null;
  const undo = useCallback(() => {
    if (!settled || last === null) return Promise.resolve(false);
    const asked = vaultKey;
    const path = last.undo.to;
    const named = { activity: logOfVaultOpenNow(activity), write: 'edit', path } as const;
    setUndoing((count) => count + 1);
    return writes
      .enqueue(ports, async (paths) => {
        // Pressed twice, or for one already taken back: there is nothing left to take back.
        if (writes.undone(last.undo)) return { done: false, wrote: false, moved: null };
        try {
          await withGiveUpRecorded({ ...named, refusal: ClarifyRefusedError }, () =>
            undoClarifyInboxItem({ ports, undo: last.undo, notePaths: paths }),
          );
          writes.markUndone(last.undo);
          setSaid((before) =>
            before?.vaultKey === asked && before.last === last
              ? { ...before, problem: null, refusal: null, last: null }
              : before,
          );
          const moved = last.undo.to === last.undo.from ? null : { from: path, to: last.undo.from };
          return { done: true, wrote: true, moved };
        } catch (cause) {
          say(asked, { problem: errorMessage(cause), refusal: null, last: 'kept' });
          return { done: false, wrote: false, moved: null };
        }
      })
      .finally(() => setUndoing((count) => count - 1));
  }, [settled, last, vaultKey, activity, writes, ports, say]);

  // The undo lasts as long as the bar offering it (#165): once that has gone, so has the undo.
  const dismissLastAction = useCallback(
    () => setSaid((before) => (before === null ? null : { ...before, last: null })),
    [],
  );

  const statuses = useMemo(() => clarifyVocabulary(types).statuses, [types]);
  // One object per clarification, not one per render: its bar's time is kept by it (#165).
  const lastAction = useMemo(() => (last === null ? null : { title: last.title }), [last]);
  return {
    contents,
    /** The statuses a row may give a task: the ones the vault's Task type declares. */
    statuses,
    error: shown?.error ?? offered?.error ?? null,
    filing: offered?.filing ?? NONE,
    people: offered?.people ?? NONE,
    /** While an undo is being written, so it is not asked for twice. */
    busy: undoing > 0,
    /** Why the last undo could not be done, or null. */
    problem: told?.problem ?? null,
    /** Why the last clarification was refused or left unfinished, and the row it was for. */
    refusal: told?.refusal ?? null,
    /** The last clarification, while it can be taken back. */
    lastAction,
    clarify,
    undo,
    dismissLastAction,
    /** Lists the next page of what waits (#167). */
    showMore,
  };
}

/** Where a clarification moved its note, for the next one's list of notes. */
function movedBy(outcome: ClarifyOutcome): EntryMove | null {
  return outcome.movedFrom === null ? null : { from: outcome.movedFrom, to: outcome.path };
}

/**
 * The Activity log of the vault open now, kept for a write that may begin
 * later: a clarification queued behind others is recorded where it was asked
 * for, not in whatever vault is open by the time it is written.
 */
function logOfVaultOpenNow(
  activity: Pick<ActivityLog, 'inOpenVault'>,
): Pick<ActivityLog, 'inOpenVault'> {
  const recorder = activity.inOpenVault();
  return { inOpenVault: () => recorder };
}

/** What one queued write did: whether it was done, whether it wrote, and where it moved a note. */
interface Written {
  readonly done: boolean;
  readonly wrote: boolean;
  readonly moved: EntryMove | null;
}

/**
 * The clarifications being written behind the page (#217): one after another,
 * in the order asked for, as Proposals writes its answers (#166) — and held
 * to by the window's close. Which rows have left the list before the index
 * says so, and the moves the tree has not caught up with, are kept here.
 */
function useClarifyWrites({
  onSettled,
  closing,
  notePaths,
  indexKey,
}: {
  onSettled: () => void;
  closing: WindowClosingPort;
  notePaths: readonly VaultPath[];
  indexKey: string;
}) {
  const wroteSinceDrained = useRef(false);
  const queue = useAnswerQueue(() => {
    if (!wroteSinceDrained.current) return;
    wroteSinceDrained.current = false;
    onSettled();
  });
  useAnswersWrittenBeforeClose(queue, closing);
  // Read when a write begins or ends, not when it was asked for: the latest the page knows.
  const latest = useRef({ notePaths, indexKey });
  useEffect(() => {
    latest.current = { notePaths, indexKey };
  }, [notePaths, indexKey]);
  const moves = useRef<readonly EntryMove[]>([]);
  const undone = useRef(new WeakSet<ClarifyUndo>());
  /** One clock for the page's reads and writes, so a read can be told from one begun before a write ended. */
  const moment = useRef(0);
  const [leaving, setLeaving] = useState<{
    readonly vaultKey: string | null;
    readonly rows: readonly LeavingRow[];
  }>({ vaultKey: null, rows: [] });

  const setRow = useCallback((vaultKey: string | null, path: VaultPath, row: LeavingRow | null) => {
    setLeaving((before) => {
      const rows = (before.vaultKey === vaultKey ? before.rows : []).filter(
        (each) => each.path !== path,
      );
      return { vaultKey, rows: row === null ? rows : [...rows, row] };
    });
  }, []);

  const enqueue = useCallback(
    (vault: object, write: (notePaths: readonly VaultPath[]) => Promise<Written>) => {
      let done = false;
      queue.enqueue(vault, async () => {
        const known = notesAfterOwnMoves(latest.current.notePaths, moves.current);
        const result = await write(known.notes);
        moves.current = result.moved === null ? known.unseen : [...known.unseen, result.moved];
        if (result.wrote) wroteSinceDrained.current = true;
        done = result.done;
      });
      // Settles once this write — and the re-read, when it was the last — is done.
      return queue.drained().then(() => done);
    },
    [queue],
  );

  const actions = useMemo(
    () => ({
      enqueue,
      moment,
      /** Takes a row off the list while it is written. */
      leave: (vaultKey: string | null, path: VaultPath) =>
        setRow(vaultKey, path, { path, settled: null }),
      /** Its write is done: off the list until a read of the index that has caught up with it. */
      written: (vaultKey: string | null, path: VaultPath) => {
        moment.current += 1;
        const settled = { at: moment.current, indexKey: latest.current.indexKey };
        setRow(vaultKey, path, { path, settled });
      },
      /** Its write was refused or failed: the row is back. */
      stay: (vaultKey: string | null, path: VaultPath) => setRow(vaultKey, path, null),
      undone: (undo: ClarifyUndo) => undone.current.has(undo),
      markUndone: (undo: ClarifyUndo) => void undone.current.add(undo),
    }),
    [enqueue, setRow],
  );
  // Apart from the actions, so a row leaving does not make every row's actions new.
  return { actions, leaving };
}

const NO_ROWS: readonly LeavingRow[] = [];

const NONE: readonly RelationChoice[] = [];

/** A read of the Inbox, and the vault it was read from. */
interface Listing {
  readonly vaultKey: string | null;
  readonly contents: InboxListing | null;
  readonly error: string | null;
  /** When the read began, so a row that left since is kept off what it found. */
  readonly read: ReadMoment;
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
 * What waits, as the page lists it: the first page, and a page more each
 * time more are asked for (#167) — each read on from the last note listed,
 * never by position and never from the top again, so no read is larger than
 * a page and filing between pages skips nothing. Read again when the index
 * changes, it reads up to the last note shown, a page at a time; another
 * vault starts at its first page.
 */
function useInboxListing({
  index,
  vaultKey,
  indexKey,
  fresh,
  tasksStartInInbox,
  moment,
}: {
  index: InboxOptions['ports']['index'];
  vaultKey: string | null;
  indexKey: string;
  fresh: boolean;
  tasksStartInInbox: boolean;
  /** The page's clock of reads and writes, which each read is stamped from as it begins. */
  moment: { current: number };
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  // How far down the page has been shown, by the last note listed; nothing past the first page until asked.
  const reach = useRef<{ vaultKey: string | null; through: InboxKey } | null>(null);
  // One more each time a read lands in the list, so a page knows whether the list it extends is still up.
  const landed = useRef(0);
  const [readAgain, setReadAgain] = useState(0);
  const land = useCallback((next: Listing) => {
    landed.current += 1;
    setListing((before) => ({ ...next, contents: keptRows(before, next) }));
  }, []);

  useEffect(() => {
    if (!fresh) return;
    let cancelled = false;
    const begunFrom = reach.current;
    const through = begunFrom?.vaultKey === vaultKey ? begunFrom.through : null;
    moment.current += 1;
    const begun = { at: moment.current, indexKey };
    const read =
      through === null
        ? listInbox({ index, tasksStartInInbox })
        : listInboxThrough({ index, through, tasksStartInInbox });
    // Shown further down while this read ran: what it found stops short of that, so read again that far.
    const reachedPast = () => reach.current !== begunFrom && reach.current?.vaultKey === vaultKey;
    const settle = (next: Listing) => {
      if (cancelled) return;
      if (reachedPast()) setReadAgain((count) => count + 1);
      else land(next);
    };
    read
      .then((contents) => settle({ vaultKey, contents, error: null, read: begun }))
      .catch((cause: unknown) =>
        settle({ vaultKey, contents: null, error: errorMessage(cause), read: begun }),
      );
    return () => {
      cancelled = true;
    };
  }, [index, indexKey, fresh, vaultKey, tasksStartInInbox, readAgain, land, moment]);

  const showMore = useCallback(() => {
    const shown = listing?.vaultKey === vaultKey ? listing.contents : null;
    // The list is as old as its first page: a row that left since that read stays off it.
    const read = listing?.read ?? { at: 0, indexKey: '' };
    const after = shown?.last ?? null;
    if (shown === null || !shown.truncated || after === null) return;
    const begun = landed.current;
    listInbox({ index, after, tasksStartInInbox })
      .then((page) => {
        reach.current = { vaultKey, through: page.last ?? after };
        // Another read landed meanwhile, so the list is newer than this page: read it again, this far down.
        if (landed.current !== begun) setReadAgain((count) => count + 1);
        else land({ vaultKey, contents: followedBy(shown, page), error: null, read });
      })
      .catch((cause: unknown) => {
        if (landed.current === begun)
          land({ vaultKey, contents: shown, error: errorMessage(cause), read });
      });
  }, [listing, vaultKey, index, tasksStartInInbox, land]);

  return { listing, showMore };
}

const byPath = (each: { readonly path: string }) => each.path;

/** What a read found, keeping the rows the list already shows unchanged, for the same vault. */
function keptRows(before: Listing | null, next: Listing): InboxListing | null {
  const shown = before?.vaultKey === next.vaultKey ? (before.contents?.items ?? null) : null;
  if (next.contents === null || shown === null) return next.contents;
  return { ...next.contents, items: keptWhereSame(shown, next.contents.items, byPath) };
}

/** The list as shown, with the page read on from its last note after it. */
function followedBy(shown: InboxListing, page: InboxListing): InboxListing {
  return {
    items: [...shown.items, ...page.items],
    truncated: page.truncated,
    total: page.total,
    last: page.last ?? shown.last,
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
