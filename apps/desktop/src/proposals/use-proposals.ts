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
  type ProposalPorts,
} from '@atlas/application';
import type { ProposalNotice, ProposalsContents, ProposalsSectionProps } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';

export interface ProposalsOptions {
  readonly ports: ProposalPorts;
  readonly clock: Pick<Clock, 'today'>;
  /** Changes when the index does — a proposal synced in, say — so the list is read again. */
  readonly indexKey: string;
  /** Re-reads the tree and the index once an answer has written or moved notes. */
  readonly onSettled: () => void;
  /** Where an answer the section gives up on is recorded; a refusal is not. */
  readonly activity: Pick<ActivityLog, 'inOpenVault'>;
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
  };
}

/**
 * The proposals waiting in the Inbox, and the answers to them (P29-02). The
 * rules are the use-cases'; this holds what is on screen — the list, which
 * proposal is being answered, why an answer was refused, and the last accept,
 * for its Undo.
 */
export function useProposals({ ports, clock, indexKey, onSettled, activity }: ProposalsOptions) {
  const [contents, setContents] = useState<ProposalsContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<VaultPath | 'undo' | null>(null);
  const [problems, setProblems] = useState<ReadonlyMap<VaultPath, string>>(new Map());
  const [notice, setNotice] = useState<ProposalNotice | null>(null);
  const [reads, setReads] = useState(0);
  const lastAccepted = useRef<AcceptedProposal | null>(null);
  // `busy` reaches the buttons a render late; two presses in one tick would both see it free.
  const answering = useRef(false);

  // What the page says about answers belongs to the vault they were given in:
  // another vault (its own files) gets none of it — above all not Undo, which
  // would run one vault's paths against another's.
  const { fs } = ports;
  useEffect(
    () => () => {
      lastAccepted.current = null;
      setNotice(null);
      setProblems(new Map());
    },
    [fs],
  );

  useEffect(() => {
    let cancelled = false;
    listProposals(ports)
      .then((listing) => {
        if (cancelled) return;
        setContents({
          open: listing.open.map((listed) => listed.proposal),
          stranded: listing.stranded.map((listed) => listed.proposal),
          unreadable: listing.unreadable,
        });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [ports, indexKey, reads]);

  const answer = useCallback(
    async (key: VaultPath | 'undo', run: () => Promise<ProposalNotice>) => {
      if (answering.current) return;
      answering.current = true;
      setBusy(key);
      const path = key === 'undo' ? null : key;
      const named = { activity, write: 'proposal', path, refusal: ANSWER_REFUSALS } as const;
      try {
        setNotice(await withGiveUpRecorded(named, run));
        if (key !== 'undo') setProblems((was) => without(was, key));
        onSettled();
        setReads((count) => count + 1);
      } catch (cause) {
        if (key === 'undo') setNotice({ text: messageOf(cause), opens: null, undoable: false });
        else setProblems((was) => new Map(was).set(key, messageOf(cause)));
      } finally {
        answering.current = false;
        setBusy(null);
      }
    },
    [onSettled, activity],
  );

  const onAccept = useCallback(
    (path: VaultPath, payload?: unknown) =>
      void answer(path, async () => {
        const accepted = await acceptProposalNote({
          ports,
          path,
          today: clock.today(),
          ...(payload !== undefined && { payload }),
        });
        lastAccepted.current = accepted;
        return acceptedNotice(accepted);
      }),
    [answer, ports, clock],
  );

  const onReject = useCallback(
    (path: VaultPath) =>
      void answer(path, async () => {
        const rejected = await rejectProposalNote({ ports, path, today: clock.today() });
        lastAccepted.current = null;
        return {
          text: `Rejected: ${noteTitle(path)}.${archivedNote(rejected)}`,
          opens: null,
          undoable: false,
        };
      }),
    [answer, ports, clock],
  );

  const onUndo = useCallback(() => {
    const accepted = lastAccepted.current;
    if (accepted === null) return;
    void answer('undo', async () => {
      await undoAcceptedProposal({ ports, accepted });
      lastAccepted.current = null;
      return {
        text: `Undone: ${accepted.headline} is back in the Inbox.`,
        opens: null,
        undoable: false,
      };
    });
  }, [answer, ports]);

  const section = useMemo<ProposalsSectionState>(
    () => ({ contents, error, notice, busy, problems, onAccept, onReject, onUndo }),
    [contents, error, notice, busy, problems, onAccept, onReject, onUndo],
  );
  return { section, count: contents?.open.length ?? null };
}

function without(problems: ReadonlyMap<VaultPath, string>, path: VaultPath) {
  if (!problems.has(path)) return problems;
  const next = new Map(problems);
  next.delete(path);
  return next;
}
