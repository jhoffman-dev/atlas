import type { ProposalNote, VaultPath } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { PageBar, type PageHistory } from '../page-bar.tsx';
import { PageHead } from '../page-head.tsx';
import { ProposalCard } from './proposal-card.tsx';

/** What the Proposals page lists, once the folder has been read. */
export interface ProposalsContents {
  /** Newest first. */
  readonly open: readonly ProposalNote[];
  /** Notes that say they are proposals and cannot be read, with why. */
  readonly unreadable: readonly { readonly path: VaultPath; readonly problem: string }[];
}

/** What the last answer did, said at the top of the page. */
export interface ProposalNotice {
  readonly text: string;
  /** The note an accept made or changed, to open from the notice. */
  readonly opens: { readonly path: VaultPath; readonly title: string } | null;
  /** Whether the answer can be taken back from the notice. */
  readonly undoable: boolean;
}

export interface ProposalsPageProps {
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
  readonly onShowSidebar?: () => void;
  readonly history?: PageHistory;
}

/**
 * The proposals waiting for an answer (P29-02): what Claude or an automation
 * suggested, each with the line it came from, to accept, edit first, or
 * reject. Nothing it proposes is written until it is accepted.
 */
export function ProposalsPage(props: ProposalsPageProps) {
  return (
    <>
      <PageBar
        crumb={{ icon: 'proposal', parent: 'Proposals' }}
        name="Open proposals"
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide proposals" aria-label="Proposals">
          <PageHead icon="proposal" title="Proposals" description={describe(props.contents)} />
          {props.notice !== null && <Notice {...props} notice={props.notice} />}
          <ProposalList {...props} />
          {props.contents !== null && props.contents.unreadable.length > 0 && (
            <Unreadable unreadable={props.contents.unreadable} onOpen={props.onOpen} />
          )}
        </article>
      </div>
    </>
  );
}

function describe(contents: ProposalsContents | null): string | null {
  if (contents === null) return null;
  const count = contents.open.length;
  return `${count} open ${count === 1 ? 'proposal' : 'proposals'} · nothing is written until you accept`;
}

function Notice({ notice, busy, onOpen, onUndo }: ProposalsPageProps & { notice: ProposalNotice }) {
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

function ProposalList(props: ProposalsPageProps) {
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
