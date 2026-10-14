import { useEffect, useRef, type RefObject } from 'react';
import { proposalHeadline, type ProposalNote, type VaultPath } from '@atlas/domain';
import { UNDO_BAR_MS, useDismissAfter } from '../dismiss-after.ts';
import { Icon } from '../icon.tsx';
import { ProposalCard } from './proposal-card.tsx';

/** What the Inbox's Proposals section lists, once the folder has been read. */
export interface ProposalsContents {
  /** Newest first. */
  readonly open: readonly ProposalNote[];
  /** Why each open proposal was made, by its path, as its maker wrote it; none for one that says nothing. */
  readonly reasons?: ReadonlyMap<VaultPath, string>;
  /** Answered, yet still in the Inbox: the Archive refused them. */
  readonly stranded: readonly ProposalNote[];
  /** Notes that say they are proposals and cannot be read, with why. */
  readonly unreadable: readonly { readonly path: VaultPath; readonly problem: string }[];
}

/** What the last answer did, said at the top of the section. */
export interface ProposalNotice {
  readonly text: string;
  /** The note an accept made or changed, to open from the notice. */
  readonly opens: { readonly path: VaultPath; readonly title: string } | null;
  /** Whether the answer can be taken back from the notice. */
  readonly undoable: boolean;
  /** Whether it says something failed: then it stays until dismissed, rather than going by itself. */
  readonly failed: boolean;
}

export interface ProposalsSectionProps {
  /** Null while the folder is being read. */
  readonly contents: ProposalsContents | null;
  readonly error: string | null;
  readonly notice: ProposalNotice | null;
  /**
   * `undo` while an accept is being undone, which holds the answers until it
   * is; null otherwise. An answer itself holds nothing: its proposal leaves
   * the list at once, and is written behind it (#166).
   */
  readonly busy: 'undo' | null;
  /** Why answering a proposal was refused, by its path. */
  readonly problems: ReadonlyMap<VaultPath, string>;
  /** Whether answers are still being written: the section stays while they are, though none is left to answer. */
  readonly answering?: boolean;
  /** Accepts a proposal — with its payload as edited, when it was. */
  readonly onAccept: (path: VaultPath, payload?: unknown) => void;
  readonly onReject: (path: VaultPath) => void;
  readonly onUndo: () => void;
  /** Takes the notice away — and the Undo it offered — once it has had its time (#165), or when asked. */
  readonly onDismissNotice: () => void;
  readonly onOpen: (path: VaultPath) => void;
  /** Opens the block a proposal cites, given as its link. */
  readonly onOpenSource: (link: string) => void;
}

/**
 * The proposals waiting for an answer, as a section of the Inbox page
 * (P29-02, P30-01): what Claude or an automation suggested, each with the
 * line it came from, to accept, edit first, or reject. Nothing it proposes is
 * written until it is accepted. Proposals wait in the Inbox but are answered
 * here, never filed with the notes beside them.
 */
export function ProposalsSection(props: ProposalsSectionProps) {
  const { heading, list, keepingFocus } = useFocusKeptOnAnswer(props.contents);
  return (
    <section className="proposals" aria-label="Proposals">
      <h2 className="proposals__heading" tabIndex={-1} ref={heading}>
        <Icon name="spark" size={16} /> Proposals
      </h2>
      <p className="proposals__summary">{describe(props.contents)}</p>
      {props.notice !== null && <Notice {...props} notice={props.notice} />}
      <ProposalList {...props} list={list} keepingFocus={keepingFocus} />
      {props.contents !== null && props.contents.stranded.length > 0 && (
        <Stranded stranded={props.contents.stranded} onOpen={props.onOpen} />
      )}
      {props.contents !== null && props.contents.unreadable.length > 0 && (
        <Unreadable unreadable={props.contents.unreadable} onOpen={props.onOpen} />
      )}
    </section>
  );
}

/** Whether the section has anything to show: something to answer, to look at, to undo, or being written. */
export function proposalsToShow({
  contents,
  error,
  notice,
  answering = false,
}: ProposalsSectionProps): boolean {
  if (error !== null || notice !== null || answering) return true;
  if (contents === null) return false;
  return contents.open.length + contents.stranded.length + contents.unreadable.length > 0;
}

function describe(contents: ProposalsContents | null): string | null {
  if (contents === null) return null;
  const count = contents.open.length;
  return `${count} open ${count === 1 ? 'proposal' : 'proposals'} · nothing is written until you accept`;
}

/**
 * What the last answer did, for 20 seconds unless held: its Undo lasts as
 * long as it does. A failure stays until dismissed, so it is read.
 */
function Notice({
  notice,
  busy,
  onOpen,
  onUndo,
  onDismissNotice,
}: ProposalsSectionProps & { notice: ProposalNotice }) {
  const hold = useDismissAfter({
    ms: UNDO_BAR_MS,
    showing: notice,
    onDismiss: onDismissNotice,
    stays: notice.failed,
  });
  return (
    <div className="proposals__notice" role="status" {...hold}>
      <span>{notice.text}</span>
      {notice.opens !== null && (
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => notice.opens !== null && onOpen(notice.opens.path)}
        >
          Open {notice.opens.title}
        </button>
      )}
      {notice.undoable && (
        <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={onUndo}>
          Undo
        </button>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label="Dismiss"
        onClick={onDismissNotice}
      >
        ×
      </button>
    </div>
  );
}

function ProposalList({
  list,
  keepingFocus,
  ...props
}: ProposalsSectionProps & {
  list: RefObject<HTMLUListElement | null>;
  /** Gives an answer from card `at`, its focus kept in the list once the card has left. */
  keepingFocus: (at: number, answer: () => void) => void;
}) {
  const { contents, error } = props;
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (contents === null) return <p className="table__empty">Reading the proposals…</p>;
  if (contents.open.length === 0) {
    return (
      <p className="proposals__empty">
        Nothing to answer. What Claude proposes lands here, in <code>Inbox/Proposals</code>.
      </p>
    );
  }
  return (
    <ul className="proposals__list" aria-label="Open proposals" ref={list}>
      {contents.open.map((proposal, at) => (
        <li key={proposal.path}>
          <ProposalCard
            proposal={proposal}
            reason={contents.reasons?.get(proposal.path) ?? null}
            busy={props.busy !== null}
            problem={props.problems.get(proposal.path) ?? null}
            onAccept={(payload) => keepingFocus(at, () => props.onAccept(proposal.path, payload))}
            onReject={() => keepingFocus(at, () => props.onReject(proposal.path))}
            onOpen={() => props.onOpen(proposal.path)}
            onOpenSource={props.onOpenSource}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * An answered card leaves the list at once (#166), and the focus on its
 * button would fall to the page: it goes instead to the card that took its
 * place — the next, or the one before when it was the last — or, with none
 * left, to the section's heading, so the next answer is a key away.
 */
function useFocusKeptOnAnswer(contents: ProposalsContents | null) {
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const answeredAt = useRef<number | null>(null);
  useEffect(() => {
    const at = answeredAt.current;
    if (at === null) return;
    const focused = document.activeElement;
    // Only focus that was lost with the card: never taken from wherever the person moved it.
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    answeredAt.current = null;
    const cards = list.current?.children ?? [];
    const card = cards[Math.min(at, cards.length - 1)];
    const action = card?.querySelector<HTMLElement>('button');
    (action ?? heading.current)?.focus();
  }, [contents]);
  const keepingFocus = (at: number, answer: () => void) => {
    const focused = document.activeElement;
    answeredAt.current = focused !== null && list.current?.contains(focused) === true ? at : null;
    answer();
  };
  return { heading, list, keepingFocus };
}

/** Proposals answered but never filed away: said so, with each a click from its note. */
function Stranded({
  stranded,
  onOpen,
}: {
  stranded: readonly ProposalNote[];
  onOpen: (path: VaultPath) => void;
}) {
  return (
    <section className="proposals__unreadable" aria-label="Answered, still in the Inbox">
      <h2>Answered, still in the Inbox</h2>
      <p>These were answered, but could not be moved to the Archive. Archive each from its page.</p>
      <ul>
        {stranded.map((proposal) => (
          <li key={proposal.path}>
            <button type="button" className="proposals__path" onClick={() => onOpen(proposal.path)}>
              {proposalHeadline(proposal)}
            </button>
            <span>{proposal.state === 'rejected' ? 'Rejected' : 'Accepted'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Unreadable({
  unreadable,
  onOpen,
}: {
  unreadable: ProposalsContents['unreadable'];
  onOpen: (path: VaultPath) => void;
}) {
  return (
    <section className="proposals__unreadable" aria-label="Proposals that cannot be read">
      <h2>
        <Icon name="close" size={14} /> Can’t be read
      </h2>
      <ul>
        {unreadable.map(({ path, problem }) => (
          <li key={path}>
            <button type="button" className="proposals__path" onClick={() => onOpen(path)}>
              {path}
            </button>
            <span>{problem}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
