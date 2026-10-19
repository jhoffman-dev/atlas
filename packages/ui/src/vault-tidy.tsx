import { useId } from 'react';
import { Icon } from './icon.tsx';
import type { InboxOfferReading } from './inbox-offer.ts';

/** One note the tidy would move, as the preview lists it. */
export interface VaultTidyMove {
  readonly from: string;
  readonly to: string;
}

/** A note the tidy leaves where it is, and why. */
export interface VaultTidyRefusal {
  readonly path: string;
  readonly reason: string;
}

/** What tidying the vault would do, as the preview shows it. */
export interface VaultTidyPreviewData {
  readonly moves: readonly VaultTidyMove[];
  readonly refused: readonly VaultTidyRefusal[];
}

export interface VaultTidyProps extends InboxOfferReading {
  /** What the tidy would do; null when there is nothing to move. */
  readonly preview: VaultTidyPreviewData | null;
  /** Whether the whole preview is shown, rather than the one-line offer. */
  readonly open: boolean;
  readonly busy: boolean;
  /** What the last tidy did, in a sentence. */
  readonly result: string | null;
  readonly problem: string | null;
  readonly onOpen: () => void;
  readonly onApply: () => void;
  readonly onClose: () => void;
  /** Ends the offer for now, and what the last tidy said. */
  readonly onDismiss: () => void;
}

const notes = (count: number) => (count === 1 ? '1 note' : `${count} notes`);

/**
 * The offer to tidy the vault once (#214): one line until asked, then every
 * move the tidy would make, from where each note is to its home folder, and
 * every note it would leave where it is with why. Nothing moves until the
 * person presses Move.
 */
export function VaultTidy(props: VaultTidyProps) {
  const { preview, open, result, problem } = props;
  if (preview === null && result === null && problem === null) return null;
  return (
    <section className="inbox__offer vault-tidy" aria-label="Tidy the vault">
      <Icon name="folder" size={16} className="inbox__offer-icon" />
      <div className="inbox__offer-text">
        {preview !== null && !open && <Offer {...props} preview={preview} />}
        {preview !== null && open && <Preview {...props} preview={preview} />}
        {result !== null && <p role="status">{result}</p>}
        {problem !== null && (
          <p className="table__error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {preview === null && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={props.onDismiss}
          disabled={props.busy}
        >
          Dismiss
        </button>
      )}
    </section>
  );
}

function Offer({ preview, onOpen, onDismiss }: VaultTidyProps & { preview: VaultTidyPreviewData }) {
  return (
    <div className="vault-tidy__offer">
      <p>
        Every type has a home folder now. {notes(preview.moves.length)} could move to theirs, out of
        the root of the vault and the old Inbox/Meetings.
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
        Preview the tidy
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        Not now
      </button>
    </div>
  );
}

function Preview(props: VaultTidyProps & { preview: VaultTidyPreviewData }) {
  const { preview, busy, onApply, onClose } = props;
  return (
    <div className="vault-tidy__preview">
      <p>
        Nothing moves until you say so. Each note keeps its name and its text, and links to it are
        rewritten so they still open it.
      </p>
      <MoveTable moves={preview.moves} />
      <Refused refused={preview.refused} />
      <div className="vault-tidy__actions">
        <button type="button" className="btn btn--sm" onClick={onApply} disabled={busy}>
          Move {notes(preview.moves.length)}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MoveTable({ moves }: { moves: readonly VaultTidyMove[] }) {
  return (
    <div className="vault-tidy__moves">
      <table aria-label="Notes that move">
        <thead>
          <tr>
            <th>Now</th>
            <th>Moves to</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((move) => (
            <tr key={move.from}>
              <td>{move.from}</td>
              <td>{move.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Refused({ refused }: { refused: readonly VaultTidyRefusal[] }) {
  const id = useId();
  if (refused.length === 0) return null;
  return (
    <div className="vault-tidy__refused">
      <h3 id={id}>Left where they are</h3>
      <ul aria-labelledby={id}>
        {refused.map(({ path, reason }) => (
          <li key={path}>
            {path}: {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
