import { useState } from 'react';
import { isImeKey } from './ime.ts';
import type { OverlaySlot } from './overlay-slot.ts';
import { ToolbarPopover } from './view-query-popovers.tsx';

/**
 * What the toolbar offers while the view on screen differs from the view note:
 * keep the changes in this view, keep them in a new one, or drop them. Shown
 * only then, so its appearing is itself the sign that something is unsaved.
 */
export function ViewSaveControls({
  suggestedName,
  error,
  onSave,
  onSaveAs,
  onReset,
  slot,
}: {
  /** What the name field starts with — the view's own name, marked as a copy. */
  suggestedName: string;
  /** Why the last save as a new view was refused. */
  error: string | null;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onReset: () => void;
  slot?: OverlaySlot | undefined;
}) {
  return (
    <div className="view-save" role="group" aria-label="Unsaved view changes">
      <button type="button" className="view-save__reset" onClick={onReset}>
        Reset
      </button>
      <SaveAsNew suggestedName={suggestedName} error={error} onSaveAs={onSaveAs} slot={slot} />
      <button type="button" className="view-save__save" onClick={onSave}>
        Save view
      </button>
    </div>
  );
}

function SaveAsNew({
  suggestedName,
  error,
  onSaveAs,
  slot,
}: {
  suggestedName: string;
  error: string | null;
  onSaveAs: (name: string) => void;
  slot: OverlaySlot | undefined;
}) {
  const [name, setName] = useState(suggestedName);
  const submit = () => {
    if (name.trim() !== '') onSaveAs(name.trim());
  };
  return (
    <ToolbarPopover icon="plus" label="Save as new view…" slot={slot}>
      <p className="view-popover__title">New view</p>
      <form
        className="view-popover__add"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          aria-label="New view name"
          value={name}
          aria-invalid={error !== null}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Enter while composing picks a candidate; it is not a submit.
            if (event.key === 'Enter' && isImeKey(event)) event.preventDefault();
          }}
        />
        <button type="submit" className="view-popover__submit" disabled={name.trim() === ''}>
          Save
        </button>
      </form>
      {error !== null && (
        <p className="view-popover__error" role="alert">
          {error}
        </p>
      )}
    </ToolbarPopover>
  );
}
