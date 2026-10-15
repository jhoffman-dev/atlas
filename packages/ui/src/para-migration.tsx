import { useId } from 'react';
import { Icon } from './icon.tsx';

/** What moving the vault's PARA notes onto the Project type would do, as the preview shows it. */
export interface ParaMigrationPreviewData {
  /** What the Project type gains for them, in words. */
  readonly typeLines: readonly string[];
  /** Every note that moves, each in one line: "Garden: Area → Project, PARA Area". */
  readonly notes: readonly { readonly path: string; readonly line: string }[];
  /** Every note the move leaves as it is, and why: "Garden: its PARA “Life admin” is not …". */
  readonly skipped: readonly { readonly path: string; readonly line: string }[];
}

export interface ParaMigrationProps {
  /** What the move would do; null when nothing is left to move. */
  readonly preview: ParaMigrationPreviewData | null;
  /** Whether the whole preview is shown, rather than the one-line offer. */
  readonly open: boolean;
  readonly busy: boolean;
  /** What the last run did, in a sentence. */
  readonly result: string | null;
  readonly problem: string | null;
  readonly onOpen: () => void;
  readonly onRun: () => void;
  /** Closes the preview, or puts the offer away until the vault is opened again. */
  readonly onClose: () => void;
  /** Puts away what the last run said. */
  readonly onDismiss: () => void;
}

const notes = (count: number) => (count === 1 ? '1 note' : `${count} notes`);

/**
 * The offer to move the vault's Area and Resource notes onto the one Project
 * type (#213): one line until asked, then every note that moves and what the
 * Project type gains — and nothing is written until the person says so.
 */
export function ParaMigration(props: ParaMigrationProps) {
  const { preview, open, result, problem } = props;
  if (preview === null && result === null && problem === null) return null;
  return (
    <section className="inbox__offer task-migration" aria-label="Move notes onto the Project type">
      <Icon name="board" size={16} className="inbox__offer-icon" />
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
      {result !== null && !open && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onDismiss}>
          Dismiss
        </button>
      )}
    </section>
  );
}

function Offer({
  preview,
  onOpen,
  onClose,
}: ParaMigrationProps & { preview: ParaMigrationPreviewData }) {
  return (
    <div className="task-migration__offer">
      <p>
        Projects, areas and resources are one Project type now, with a PARA property.{' '}
        {notes(preview.notes.length)} would move onto it.
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
        Preview the move
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
        Not now
      </button>
    </div>
  );
}

function Preview(props: ParaMigrationProps & { preview: ParaMigrationPreviewData }) {
  const { preview, busy, onRun, onClose } = props;
  return (
    <div className="task-migration__preview">
      <p>
        Nothing is changed until you move them. Only each note’s type and PARA are written — and,
        for an archived one, the PARA it had: its other properties, its text and where its file is
        stay as they are.
      </p>
      <Lines
        heading="The Project type"
        lines={preview.typeLines.map((line) => ({ key: line, line }))}
      />
      <Lines
        heading="Notes that move"
        lines={preview.notes.map((note) => ({ key: note.path, line: note.line }))}
      />
      <Lines
        heading="Notes left as they are"
        lines={preview.skipped.map((note) => ({ key: note.path, line: note.line }))}
      />
      <div className="task-migration__actions">
        <button type="button" className="btn btn--sm" onClick={onRun} disabled={busy}>
          Move {notes(preview.notes.length)}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Lines({
  heading,
  lines,
}: {
  heading: string;
  /** Each line, keyed by what it is about: two notes may read alike. */
  lines: readonly { readonly key: string; readonly line: string }[];
}) {
  const id = useId();
  if (lines.length === 0) return null;
  return (
    <div className="task-migration__lines">
      <h3 id={id}>{heading}</h3>
      <ul aria-labelledby={id}>
        {lines.map(({ key, line }) => (
          <li key={key}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
