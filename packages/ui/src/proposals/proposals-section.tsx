import { proposalHeadline, type ProposalNote, type VaultPath } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { ProposalCard } from './proposal-card.tsx';

/** What the Inbox's Proposals section lists, once the folder has been read. */
export interface ProposalsContents {
  /** Newest first. */
  readonly open: readonly ProposalNote[];
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
}

export interface ProposalsSectionProps {
  /** Null while the folder is being read. */
  readonly contents: ProposalsContents | null;
  readonly error: string | null;
  readonly notice: ProposalNotice | null;
  /** The proposal being answered, so it is not answered twice; or `undo` while an accept is undone. */
  readonly busy: VaultPath | 'undo' | null;
  /** Why answering a proposal was refused, by its path. */
  readonly problems: ReadonlyMap<VaultPath, string>;
  /** Accepts a proposal — with its payload as edited, when it was. */
  readonly onAccept: (path: VaultPath, payload?: unknown) => void;
  readonly onReject: (path: VaultPath) => void;
  readonly onUndo: () => void;
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
  return (
    <section className="proposals" aria-label="Proposals">
      <h2 className="proposals__heading">
        <Icon name="spark" size={16} /> Proposals
      </h2>
      <p className="proposals__summary">{describe(props.contents)}</p>
      {props.notice !== null && <Notice {...props} notice={props.notice} />}
      <ProposalList {...props} />
      {props.contents !== null && props.contents.stranded.length > 0 && (
        <Stranded stranded={props.contents.stranded} onOpen={props.onOpen} />
      )}
      {props.contents !== null && props.contents.unreadable.length > 0 && (
        <Unreadable unreadable={props.contents.unreadable} onOpen={props.onOpen} />
      )}
    </section>
  );
}

/** Whether the section has anything to show: something to answer, to look at, or to undo. */
export function proposalsToShow({ contents, error, notice }: ProposalsSectionProps): boolean {
  if (error !== null || notice !== null) return true;
  if (contents === null) return false;
  return contents.open.length + contents.stranded.length + contents.unreadable.length > 0;
}

function describe(contents: ProposalsContents | null): string | null {
  if (contents === null) return null;
  const count = contents.open.length;
  return `${count} open ${count === 1 ? 'proposal' : 'proposals'} · nothing is written until you accept`;
}

function Notice({
  notice,
  busy,
  onOpen,
  onUndo,
}: ProposalsSectionProps & { notice: ProposalNotice }) {
  return (
    <div className="proposals__notice" role="status">
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
    </div>
  );
}

function ProposalList(props: ProposalsSectionProps) {
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
    <ul className="proposals__list" aria-label="Open proposals">
      {contents.open.map((proposal) => (
        <li key={proposal.path}>
          <ProposalCard
            proposal={proposal}
            busy={props.busy !== null}
            problem={props.problems.get(proposal.path) ?? null}
            onAccept={(payload) => props.onAccept(proposal.path, payload)}
            onReject={() => props.onReject(proposal.path)}
            onOpen={() => props.onOpen(proposal.path)}
            onOpenSource={props.onOpenSource}
          />
        </li>
      ))}
    </ul>
  );
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
