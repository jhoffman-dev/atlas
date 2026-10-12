import { Icon } from './icon.tsx';

/** What a linked meeting's page says about its links, with the two things only the person does there. */
export interface LinksNotice {
  /** The people and companies linking added, by name. */
  readonly linked: readonly string[];
  /** How many proposals linking wrote for this meeting. */
  readonly proposals: number;
  /** Whether its links were undone: there is then nothing more to take back. */
  readonly undone: boolean;
  /** Whether Atlas has linked it at all: a meeting made by hand, not yet run on, has not been. */
  readonly linkedYet: boolean;
  /** Whether there is anything recorded to undo. */
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  /** Corrects the meeting again by today's terms: for a term added since it arrived. */
  readonly onCorrectAgain: () => void;
  /** What the last command did, or why it was refused; null when there is nothing to say. */
  readonly said: { readonly text: string; readonly refused: boolean } | null;
  /** While a command is being written. */
  readonly busy: boolean;
}

function leadOf({ undone, linkedYet }: Pick<LinksNotice, 'undone' | 'linkedYet'>): string {
  if (undone) return 'Links undone';
  return linkedYet ? 'Linked' : 'Not linked by Atlas yet';
}

/**
 * The band over a meeting that was linked (P29-04, P29-06): who linking
 * added and how many proposals it left in the Inbox, with Undo links — which
 * takes those links and its open proposals back — and Correct again, the one
 * way a meeting already read is corrected by a term added since.
 */
export function MeetingLinksBand({
  linked,
  proposals,
  undone,
  linkedYet,
  canUndo,
  onUndo,
  onCorrectAgain,
  said,
  busy,
}: LinksNotice) {
  return (
    <aside className="links-band" aria-label="After the meeting">
      <Icon name="link" size={16} className="links-band__icon" />
      <div className="links-band__text">
        <p className="links-band__lead">
          <strong>{leadOf({ undone, linkedYet })}</strong>
          {linkedYet &&
            !undone &&
            ` · ${linked.length === 0 ? 'no one it was sure of' : linked.join(', ')}`}
          {!undone &&
            proposals > 0 &&
            ` · ${proposals === 1 ? '1 proposal' : `${proposals} proposals`} in the Inbox`}
        </p>
        {said !== null && (
          <p
            className={
              said.refused ? 'links-band__said links-band__said--refused' : 'links-band__said'
            }
            role="status"
          >
            {said.text}
          </p>
        )}
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onCorrectAgain} disabled={busy}>
        Correct again
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onUndo}
        disabled={busy || !canUndo}
      >
        Undo links
      </button>
    </aside>
  );
}
