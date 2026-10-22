import { useState } from 'react';
import type { HighlightPlacement } from '@dfai/domain';
import type { ReaderHighlight } from './reader-types.ts';

/*
 * The document's highlights beside it (#504), in the order they come in it.
 * A click brings one into view; its comment is edited here, which edits the
 * note; it is removed here, after asking. One whose spot could not be found
 * says so rather than pretending.
 */

export interface HighlightsPanelProps {
  readonly highlights: readonly ReaderHighlight[];
  /** The one just asked for, lit for a moment. */
  readonly flashing: string | null;
  readonly onShow: (id: string) => void;
  readonly onEditComment: (request: { id: string; comment: string }) => Promise<void>;
  readonly onRemove: (id: string) => Promise<void>;
}

export function HighlightsPanel(props: HighlightsPanelProps) {
  const count = props.highlights.length;
  return (
    <aside className="pdf-panel" aria-label="Highlights">
      <h2 className="pdf-panel__title">
        Highlights <span className="pdf-panel__count">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="pdf-panel__empty">Select words on a page to highlight them.</p>
      ) : (
        <ol className="pdf-panel__list">
          {props.highlights.map((highlight) => (
            <HighlightEntry key={highlight.id} highlight={highlight} {...props} />
          ))}
        </ol>
      )}
    </aside>
  );
}

function HighlightEntry({
  highlight,
  flashing,
  onShow,
  onEditComment,
  onRemove,
}: HighlightsPanelProps & { highlight: ReaderHighlight }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { placement } = highlight;
  const classes = ['pdf-entry', `pdf-entry--${highlight.style.color}`];
  if (flashing === highlight.id) classes.push('pdf-entry--flash');
  return (
    <li className={classes.join(' ')} data-highlight-entry={highlight.id}>
      <button
        type="button"
        className="pdf-entry__show"
        disabled={placement.kind === 'lost'}
        onClick={() => onShow(highlight.id)}
      >
        <span className="pdf-entry__page">{pageLabel(placement)}</span>
        <span className="pdf-entry__quote">{quoteOf(highlight)}</span>
      </button>
      {placeNote(placement) !== null && <p className="pdf-entry__lost">{placeNote(placement)}</p>}
      {editing ? (
        <CommentForm
          comment={highlight.comment}
          onSave={async (comment) => {
            await onEditComment({ id: highlight.id, comment });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        highlight.comment !== '' && <p className="pdf-entry__comment">{highlight.comment}</p>
      )}
      {confirming ? (
        <div className="pdf-entry__confirm" role="group" aria-label="Delete this highlight?">
          <span>Delete this highlight from the note?</span>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => void onRemove(highlight.id)}
          >
            Delete
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </div>
      ) : (
        !editing && (
          <div className="pdf-entry__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setEditing(true)}
            >
              {highlight.comment === '' ? 'Add comment' : 'Edit comment'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirming(true)}
            >
              Delete…
            </button>
          </div>
        )
      )}
    </li>
  );
}

function CommentForm({
  comment,
  onSave,
  onCancel,
}: {
  comment: string;
  onSave: (comment: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(comment);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="pdf-entry__form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        // A refused save is said by the reader's notice; the form stays open to try again.
        onSave(text).finally(() => setSaving(false));
      }}
    >
      <textarea
        aria-label="Comment"
        className="pdf-entry__field"
        autoFocus
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="pdf-entry__actions">
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
          Save
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function pageLabel(placement: HighlightPlacement): string {
  return placement.kind === 'lost' ? 'No page' : `p. ${placement.page}`;
}

function quoteOf(highlight: ReaderHighlight): string {
  if (highlight.placement.kind === 'area') return 'Area of the page';
  return highlight.quote;
}

/** What the entry says about where it is drawn, when that is not exactly where it was made. */
function placeNote(placement: HighlightPlacement): string | null {
  if (placement.kind === 'boxes') {
    return "Couldn't find the exact spot: shown where it was when it was made.";
  }
  if (placement.kind === 'lost') return "Couldn't find the exact spot in this file.";
  return null;
}
