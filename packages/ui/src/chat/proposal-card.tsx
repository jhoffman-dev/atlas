import { Icon } from '../icon.tsx';
import { NoteReading } from '../note-reading.tsx';
import type { ChatItemView, ProposalBlockView } from './chat-view.ts';

type ProposalItem = Extract<ChatItemView, { kind: 'proposal' }>;

const BLOCK_LABEL = { same: 'Unchanged', added: 'Added', removed: 'Removed' } as const;

/**
 * A change the model proposed, drawn as the note would draw it: removed blocks
 * struck through, added ones marked, and unchanged runs folded. Nothing is
 * written until Accept.
 */
export function ProposalCard({
  item,
  onAccept,
  onReject,
  onUndo,
  onFollowLink,
  loadImage,
}: {
  item: ProposalItem;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  onFollowLink: (target: string) => void;
  loadImage: (src: string) => Promise<string | null>;
}) {
  const { proposal, state, problem } = item;
  const heading = proposal.kind === 'edit' ? 'Proposed edit' : 'Proposed new note';
  return (
    <section
      className="chat-proposal"
      data-state={state}
      aria-label={`${heading}: ${proposal.title}`}
    >
      <header className="chat-proposal__head">
        <Icon name="doc" size={15} />
        <span className="chat-proposal__kind">{heading}</span>
        <span className="chat-proposal__title">{proposal.title}</span>
      </header>
      <p className="chat-proposal__path">{proposal.path}</p>
      {proposal.propertyChanges.length > 0 && (
        <ul className="chat-proposal__props" aria-label="Property changes">
          {proposal.propertyChanges.map((change) => (
            <li key={change.key}>
              <span className="chat-proposal__key">{change.key}</span>
              {change.before !== null && <del>{shown(change.before)}</del>}
              {change.after === null ? <em>removed</em> : <ins>{shown(change.after)}</ins>}
            </li>
          ))}
        </ul>
      )}
      <div className="chat-proposal__blocks">
        {proposal.blocks.map((block, at) => (
          <Block key={at} block={block} onFollowLink={onFollowLink} loadImage={loadImage} />
        ))}
      </div>
      {problem !== null && (
        <p className="chat-proposal__problem" role="alert">
          {problem}
        </p>
      )}
      <footer className="chat-proposal__actions">
        {state === 'pending' || state === 'accepting' ? (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onReject}
              disabled={state === 'accepting'}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onAccept}
              disabled={state === 'accepting'}
            >
              Accept
            </button>
          </>
        ) : (
          <>
            <span className="chat-proposal__verdict" role="status">
              {VERDICT[state]}
            </span>
            {state === 'accepted' && (
              <button type="button" className="btn btn--ghost" onClick={onUndo}>
                Undo
              </button>
            )}
          </>
        )}
      </footer>
    </section>
  );
}

const VERDICT = { accepted: 'Accepted', rejected: 'Rejected', undone: 'Undone' } as const;

function Block({
  block,
  onFollowLink,
  loadImage,
}: {
  block: ProposalBlockView;
  onFollowLink: (target: string) => void;
  loadImage: (src: string) => Promise<string | null>;
}) {
  if (block.kind === 'folded') {
    return (
      <p className="chat-proposal__folded">
        {block.count === 1 ? '1 unchanged block' : `${block.count} unchanged blocks`}
      </p>
    );
  }
  return (
    <div className={`chat-proposal__block chat-proposal__block--${block.kind}`}>
      <span className="visually-hidden">{BLOCK_LABEL[block.kind]}</span>
      <NoteReading
        doc={block.doc}
        label={`${BLOCK_LABEL[block.kind]} block`}
        onFollowLink={onFollowLink}
        loadImage={loadImage}
      />
    </div>
  );
}

function shown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
