import { useState } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '@dfai/domain';
import type { MarkRequest } from './reader-types.ts';

/*
 * What a selection in the reader offers (#504): a highlight in one of the
 * muted colours, an underline, or a comment, which is a highlight with words
 * of the person's own. Pressing one never takes the selection away first:
 * the press is held back from the page.
 */

export interface MarkPopoverProps {
  /** Where it sits, in the reader's own coordinates: above the selection. */
  readonly at: { readonly left: number; readonly top: number };
  /** False for an area of a scanned page, which is only ever a highlight. */
  readonly canUnderline: boolean;
  /** A mark with a comment answers whether the note took it: the comment stays to be saved again when it did not. */
  readonly onMark: (request: MarkRequest) => void | Promise<unknown>;
  readonly onDismiss: () => void;
}

const COLOR_NAMES: Readonly<Record<HighlightColor, string>> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
  orange: 'Orange',
};

export function MarkPopover({ at, canUnderline, onMark, onDismiss }: MarkPopoverProps) {
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [color, setColor] = useState<HighlightColor>('yellow');
  return (
    <div
      className="pdf-popover"
      role="toolbar"
      aria-label="Mark the selection"
      style={{ left: at.left, top: at.top }}
      // Pressing a button must not clear the selection it acts on.
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      {commenting ? (
        <form
          className="pdf-popover__comment"
          onSubmit={(event) => {
            event.preventDefault();
            onMark({ style: { mark: 'highlight', color }, comment });
          }}
        >
          <textarea
            aria-label="Comment"
            className="pdf-popover__field"
            autoFocus
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onMark({ style: { mark: 'highlight', color }, comment });
              }
            }}
          />
          <div className="pdf-popover__row">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setCommenting(false)}
            >
              Back
            </button>
            <button type="submit" className="btn btn--primary btn--sm">
              Save comment
            </button>
          </div>
        </form>
      ) : (
        <div className="pdf-popover__row">
          {HIGHLIGHT_COLORS.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`pdf-swatch pdf-swatch--${choice}`}
              aria-label={`Highlight ${COLOR_NAMES[choice]}`}
              title={`Highlight ${COLOR_NAMES[choice].toLowerCase()}`}
              aria-pressed={choice === color}
              onClick={() => {
                setColor(choice);
                onMark({ style: { mark: 'highlight', color: choice } });
              }}
            />
          ))}
          {canUnderline && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onMark({ style: { mark: 'underline', color } })}
            >
              Underline
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setCommenting(true)}
          >
            Comment
          </button>
        </div>
      )}
    </div>
  );
}
