import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { noteTitle, type VaultPath } from '@atlas/domain';
import {
  acceptProposalNote,
  listProposals,
  ProposalRefused,
  rejectProposalNote,
  TaskRuleRefusedError,
  undoAcceptedProposal,
  type AcceptedProposal,
  type ActivityLog,
  type Clock,
  type ProposalArchived,
  type ProposalListing,
  type ProposalPorts,
  type WindowClosingPort,
} from '@atlas/application';
import type {
  ProposalNotice,
  ProposalsContents,
  ProposalsSectionProps,
  RowSelection,
} from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import { useRowSelection } from '../archive/use-row-selection.ts';
import { answeredNotice, inTurn, undoneNotice, type InTurn } from './answer-many.ts';
import { useAnswerQueue, useAnswersWrittenBeforeClose } from './answer-queue.ts';

export interface ProposalsOptions {
  readonly ports: ProposalPorts;
  readonly clock: Pick<Clock, 'today'>;
  /** Changes when the index does — a proposal synced in, say — so the list is read again. */
  readonly indexKey: string;
  /** Re-reads the tree and the index once an answer has written or moved notes. */
  readonly onSettled: () => void;
  /** Where an answer the section gives up on is recorded; a refusal is not. */
  readonly activity: Pick<ActivityLog, 'inOpenVault'>;
  /** The window's close, held until the answers still being written are written. */
  readonly closing: WindowClosingPort;
}

/** What an answer refuses so as not to write over or lose anything: shown on the card, no fault. */
const ANSWER_REFUSALS = [ProposalRefused, TaskRuleRefusedError];

/** What the Inbox's Proposals section takes from here: everything but where it opens notes. */
export type ProposalsSectionState = Omit<ProposalsSectionProps, 'onOpen' | 'onOpenSource'>;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Says where a decided proposal went, and only when it could not go to the Archive. */
function archivedNote(archived: ProposalArchived): string {
  return archived.archiveProblem === null
    ? ''
    : ` The proposal stayed in the Inbox: ${archived.archiveProblem}`;
}

function acceptedNotice(accepted: AcceptedProposal): ProposalNotice {
  const [made] = accepted.wrote;
  return {
    text: `Accepted: ${accepted.headline}.${archivedNote(accepted)}`,
    opens: made === undefined ? null : { path: made.path, title: noteTitle(made.path) },
    undoable: true,
    failed: false,
  };
}

/** What an answer leaves to say, and the accept it can undo, when it was one. */
interface Answered {
  readonly notice: ProposalNotice;
  /** What the notice's Undo takes back: none, one, or a batch (#168). */
  readonly accepted: readonly AcceptedProposal[];
}

/** What the section says, and what its notice's Undo takes back: that answer's own, never another's. */
interface Said {
  readonly notice: ProposalNotice;
  readonly undo: readonly AcceptedProposal[];
}

/**
 * The Activity log of the vault open now, kept for a write that may begin
 * later (#166): an answer queued behind others is recorded where it was
 * given, not in whatever vault is open by the time it is written.
 */
function logOfVaultOpenNow(
  activity: Pick<ActivityLog, 'inOpenVault'>,
): Pick<ActivityLog, 'inOpenVault'> {
  const recorder = activity.inOpenVault();
  return { inOpenVault: () => recorder };
}

/**
 * The proposals waiting in the Inbox, and the answers to them (P29-02). The
 * rules are the use-cases'; this holds what is on screen — the list, why an
 * answer was refused, and the last accept, for its Undo.
 *
 * An answer takes its proposal off the list at once and is written in the
 * background, after any still being written (#166), so the next card can be
 * answered straight away. One that fails puts its card back with why. The
 * proposals are read again once the answers are all written — not once for
 * each — and a read begun while any was being written is not shown, since it
 * may still list one as open. Several chosen together are answered in turn,
 * each as it would be alone, and one Undo takes back every accept (#168).
 */
export function useProposals({
  ports,
  clock,
  indexKey,
  onSettled,
  activity,
  closing,
}: ProposalsOptions) {
  const [listing, setListing] = useState<ProposalsContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [problems, setProblems] = useState<ReadonlyMap<VaultPath, string>>(new Map());
  const [reads, setReads] = useState(0);
  const { said, saidNow, say } = useSaid();
  const answered = useAnsweredPaths();
  const choosing = useRowSelection('');
  const queue = useAnswerQueue(() => {
    onSettled();
    setReads((count) => count + 1);
  });
  useAnswersWrittenBeforeClose(queue, closing);

  // What the page says about answers belongs to the vault they were given in:
  // another vault (its own files) gets none of it — above all not Undo, which
  // would run one vault's paths against another's — nor its list, nor why
  // that could not be read.
  const { fs } = ports;
  const openVault = useRef(fs);
  const { forget } = answered;
  const { clear: clearChosen, afterBatch } = choosing;
  useEffect(() => {
    openVault.current = fs;
    return () => {
      say(null);
      setProblems(new Map());
      setListing(null);
      setError(null);
      forget();
      clearChosen();
    };
  }, [fs, forget, say, clearChosen]);

  useEffect(() => {
    let cancelled = false;
    // Only this vault's answers can leave a read of it behind; another's still being written cannot.
    const begun = queue.mark(ports.fs);
    listProposals(ports)
      .then((read) => {
        if (cancelled || !queue.quietSince(ports.fs, begun)) return;
        setListing(contentsOf(read));
        setError(null);
        forget();
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [ports, indexKey, reads, queue, forget]);

  const answer = useCallback(
    (path: VaultPath, run: () => Promise<Answered>) => {
      if (!answered.take(path)) return;
      setProblems((was) => without(was, path));
      const vault = fs;
      const named = {
        activity: logOfVaultOpenNow(activity),
        write: 'proposal',
        path,
        refusal: ANSWER_REFUSALS,
      } as const;
      queue.enqueue(vault, async () => {
        try {
          const done = await withGiveUpRecorded(named, run);
          if (vault !== openVault.current) return;
          // Answered, it is chosen no more: back on the list after an Undo, it comes back unticked.
          afterBatch({ answered: [path], failed: [] });
          say({ notice: done.notice, undo: done.accepted });
        } catch (cause) {
          if (vault !== openVault.current) return;
          answered.giveBack(path);
          setProblems((was) => new Map(was).set(path, messageOf(cause)));
        }
      });
    },
    [activity, afterBatch, answered, fs, queue, say],
  );

  const onAccept = useCallback(
    (path: VaultPath, payload?: unknown) =>
      answer(path, async () => {
        const accepted = await acceptProposalNote({
          ports,
          path,
          today: clock.today(),
          ...(payload !== undefined && { payload }),
        });
        return { notice: acceptedNotice(accepted), accepted: [accepted] };
      }),
    [answer, ports, clock],
  );

  const onReject = useCallback(
    (path: VaultPath) =>
      answer(path, async () => {
        const rejected = await rejectProposalNote({ ports, path, today: clock.today() });
        return { notice: rejectedNotice(path, rejected), accepted: [] };
      }),
    [answer, ports, clock],
  );

  /**
   * Answers each of `paths` in turn, as Accept or Reject would each alone
   * (#168): those that fail come back to the list, still chosen, with why on
   * their cards; the notice counts both, and its Undo takes back every accept.
   * What the person chose while the batch was written stays chosen.
   */
  const answerMany = useCallback(
    (paths: readonly VaultPath[], verb: 'Accepted' | 'Rejected') => {
      const taken = paths.filter((path) => answered.take(path));
      if (taken.length === 0) return;
      setProblems((was) => taken.reduce(without, was));
      const vault = fs;
      const today = clock.today();
      const log = logOfVaultOpenNow(activity);
      const recorded = <Done>(path: VaultPath, write: () => Promise<Done>) =>
        withGiveUpRecorded(
          { activity: log, write: 'proposal', path, refusal: ANSWER_REFUSALS } as const,
          write,
        );
      const settle = (
        outcome: InTurn<VaultPath, ProposalArchived>,
        accepted: readonly AcceptedProposal[],
      ) => {
        if (vault !== openVault.current) return;
        for (const { item } of outcome.failed) answered.giveBack(item);
        setProblems((was) => {
          const next = new Map(was);
          for (const { item, reason } of outcome.failed) next.set(item, reason);
          return next;
        });
        const failed = outcome.failed.map(({ item }) => item);
        afterBatch({ answered: taken.filter((path) => !failed.includes(path)), failed });
        say({ notice: answeredNotice(verb, outcome), undo: accepted });
      };
      queue.enqueue(vault, async () => {
        if (verb === 'Accepted') {
          const outcome = await inTurn(taken, (path) =>
            recorded(path, () => acceptProposalNote({ ports, path, today })),
          );
          settle(outcome, outcome.done);
        } else {
          const outcome = await inTurn(taken, (path) =>
            recorded(path, () => rejectProposalNote({ ports, path, today })),
          );
          settle(outcome, []);
        }
      });
    },
    [activity, answered, afterBatch, clock, fs, ports, queue, say],
  );
  const onAcceptMany = useCallback(
    (paths: readonly VaultPath[]) => answerMany(paths, 'Accepted'),
    [answerMany],
  );
  const onRejectMany = useCallback(
    (paths: readonly VaultPath[]) => answerMany(paths, 'Rejected'),
    [answerMany],
  );

  /**
   * Takes back the accept the notice shown offers to undo — that one, never
   * another's. Queued (#166), it may finish after a later answer has said its
   * own notice: that notice and its Undo stand, and only a failure of this
   * undo is said beside it.
   */
  const onUndo = useCallback(() => {
    const asked = saidNow.current;
    const accepted = asked?.undo ?? [];
    if (asked === null || accepted.length === 0) return;
    // Still shown while it is undone, but not offered twice.
    const undoingIt: Said = { notice: asked.notice, undo: [] };
    say(undoingIt);
    setUndoing(true);
    const vault = fs;
    const named = {
      activity: logOfVaultOpenNow(activity),
      write: 'proposal',
      path: null,
      refusal: ANSWER_REFUSALS,
    } as const;
    // Last accepted, first taken back, each checked on its own: one changed since stays, and says why.
    const undoOne = (one: AcceptedProposal) =>
      withGiveUpRecorded(named, () => undoAcceptedProposal({ ports, accepted: one }));
    queue.enqueue(vault, async () => {
      const outcome = undoneNotice(accepted, await inTurn([...accepted].reverse(), undoOne));
      setUndoing(false);
      if (vault !== openVault.current) return;
      const now = saidNow.current;
      if (now === null || now === undoingIt) say({ notice: outcome, undo: [] });
      else if (outcome.failed) say(besideLater(outcome, now));
    });
  }, [activity, fs, ports, queue, say, saidNow]);

  // The undo lasts as long as the notice offering it (#165): once that has gone, so has the undo.
  const onDismissNotice = useCallback(() => say(null), [say]);

  const contents = useMemo(
    () => withoutAnswered(listing, answered.paths),
    [listing, answered.paths],
  );
  const busy = undoing ? 'undo' : null;
  const notice = said?.notice ?? null;
  const answering = answered.paths.size > 0;
  const selection = useShownSelection(choosing.selection, contents);
  const section = useMemo<ProposalsSectionState>(
    () => ({
      contents,
      error,
      notice,
      busy,
      problems,
      answering,
      onAccept,
      onReject,
      selection,
      onClearSelection: clearChosen,
      onAcceptMany,
      onRejectMany,
      onUndo,
      onDismissNotice,
    }),
    [
      contents,
      error,
      notice,
      busy,
      problems,
      answering,
      onAccept,
      onReject,
      selection,
      clearChosen,
      onAcceptMany,
      onRejectMany,
      onUndo,
      onDismissNotice,
    ],
  );
  return {
    section,
    count: contents?.open.length ?? null,
    /** Settles once every answer given so far is written, or has failed. */
    written: queue.drained,
  };
}

/**
 * What the section says, kept as well where an answer finishing later can
 * see what is shown by then, without waiting for a render.
 */
function useSaid() {
  const [said, setSaid] = useState<Said | null>(null);
  const saidNow = useRef<Said | null>(null);
  const say = useCallback((next: Said | null) => {
    saidNow.current = next;
    setSaid(next);
  }, []);
  return { said, saidNow, say };
}

/** An undo's failure, said beside the later answer's notice without taking that answer's Undo away. */
function besideLater(failure: ProposalNotice, later: Said): Said {
  return {
    notice: { ...later.notice, text: `${failure.text} ${later.notice.text}`, failed: true },
    undo: later.undo,
  };
}

/**
 * The proposals answered since the list was last read: taken off it at once,
 * and given back should the answer fail. `take` is false for one already
 * being answered — two presses in one tick, before either has drawn.
 */
function useAnsweredPaths() {
  const [paths, setPaths] = useState<ReadonlySet<VaultPath>>(new Set());
  const now = useRef<ReadonlySet<VaultPath>>(paths);
  const set = useCallback((next: ReadonlySet<VaultPath>) => {
    now.current = next;
    setPaths(next);
  }, []);
  const take = useCallback(
    (path: VaultPath) => {
      if (now.current.has(path)) return false;
      set(new Set(now.current).add(path));
      return true;
    },
    [set],
  );
  const giveBack = useCallback(
    (path: VaultPath) => set(new Set([...now.current].filter((held) => held !== path))),
    [set],
  );
  const forget = useCallback(() => {
    if (now.current.size > 0) set(new Set());
  }, [set]);
  return useMemo(() => ({ paths, take, giveBack, forget }), [paths, take, giveBack, forget]);
}

/** The choice as far as it reaches proposals still open on the list: an answered one is chosen no more. */
function useShownSelection(
  selection: RowSelection,
  contents: ProposalsContents | null,
): RowSelection {
  return useMemo(() => {
    const open = new Set<string>(contents?.open.map((proposal) => proposal.path) ?? []);
    const selected = new Set([...selection.selected].filter((path) => open.has(path)));
    return { ...selection, selected };
  }, [selection, contents]);
}

function contentsOf(read: ProposalListing): ProposalsContents {
  return {
    open: read.open.map((listed) => listed.proposal),
    reasons: new Map(read.open.map((listed) => [listed.proposal.path, listed.reason])),
    stranded: read.stranded.map((listed) => listed.proposal),
    unreadable: read.unreadable,
  };
}

/** The list as last read, less the proposals answered since. */
function withoutAnswered(
  listing: ProposalsContents | null,
  answered: ReadonlySet<VaultPath>,
): ProposalsContents | null {
  if (listing === null || answered.size === 0) return listing;
  return { ...listing, open: listing.open.filter((proposal) => !answered.has(proposal.path)) };
}

function rejectedNotice(path: VaultPath, rejected: ProposalArchived): ProposalNotice {
  return {
    text: `Rejected: ${noteTitle(path)}.${archivedNote(rejected)}`,
    opens: null,
    undoable: false,
    // Left in the Inbox, it has nothing to undo and must be read: it stays until dismissed.
    failed: rejected.archiveProblem !== null,
  };
}

function without(problems: ReadonlyMap<VaultPath, string>, path: VaultPath) {
  if (!problems.has(path)) return problems;
  const next = new Map(problems);
  next.delete(path);
  return next;
}
