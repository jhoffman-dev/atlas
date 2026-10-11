import { Icon } from './icon.tsx';

/** One spelling the import put right in a meeting, and how many times. */
export interface CorrectedSpelling {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

/** What a corrected meeting's page says about its corrections, and the way to take them back. */
export interface CorrectionsNotice {
  readonly spellings: readonly CorrectedSpelling[];
  readonly onUndo: () => void;
  /** Why the last Undo was refused; null when there is nothing to say. */
  readonly refusal: string | null;
  /** While an Undo is being written. */
  readonly undoing: boolean;
}

/**
 * The band over a meeting whose misheard spellings the import put right
 * (P28-06): each change, so the corrected words can be trusted, and one
 * Undo that puts every original word back.
 */
export function MeetingCorrectionsBand({ spellings, onUndo, refusal, undoing }: CorrectionsNotice) {
  const total = spellings.reduce((sum, spelling) => sum + spelling.count, 0);
  return (
    <aside className="corrections-band" aria-label="Corrections">
      <Icon name="term" size={16} className="corrections-band__icon" />
      <div className="corrections-band__text">
        <p className="corrections-band__lead">
          <strong>Corrected</strong> · {total === 1 ? '1 spelling' : `${total} spellings`} put right
          on import
        </p>
        <ul className="corrections-band__list">
          {spellings.map((spelling) => (
            <li key={`${spelling.from}\u0000${spelling.to}`}>
              <s>{spelling.from}</s> → {spelling.to}
              {spelling.count > 1 && (
                <span className="corrections-band__count"> ×{spelling.count}</span>
              )}
            </li>
          ))}
        </ul>
        {refusal !== null && (
          <p className="corrections-band__refusal" role="status">
            {refusal}
          </p>
        )}
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onUndo} disabled={undoing}>
        Undo corrections
      </button>
    </aside>
  );
}
