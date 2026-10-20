import { useState, type ReactNode } from 'react';

/**
 * The head of a reading page — a note, a template, a type: its title, 24/600,
 * editable in place (FlowSplit.dc.html). Nothing else: no tile, no line under
 * it (brief rule 6). Every other page is headed by the nav bar's breadcrumb,
 * with what it holds as the count beside its name, and keeps a `HiddenTitle`.
 */
export interface PageHeadProps {
  /** The title, or an `EditableTitle` when it can be changed in place. */
  title: ReactNode;
}

export function PageHead({ title }: PageHeadProps) {
  return (
    <header className="page-head">
      <h1 className="page-head__title">{title}</h1>
    </header>
  );
}

/**
 * The `h1` of a page whose title is drawn only in the breadcrumb: read by a
 * screen reader, found by name, never seen.
 */
export function HiddenTitle({ children }: { children: string }) {
  return <h1 className="visually-hidden">{children}</h1>;
}

/**
 * A title that becomes a text field when pressed, and commits on Enter or on
 * leaving it. Escape or an unchanged title change nothing; a blank one changes
 * nothing unless `onClear` says what clearing means.
 */
export function EditableTitle({
  value,
  label,
  hint,
  onCommit,
  editing: editingFromOutside = false,
  onDone,
  onClear,
  inputClassName = 'page-head__title-input',
}: {
  value: string;
  /** The field's accessible name — "Note name" when it renames the file. */
  label: string;
  /** What pressing the title does, shown as its tooltip. */
  hint: string;
  onCommit: (value: string) => void;
  /** Opens the field without a press — from a menu command, say. */
  editing?: boolean;
  /** Told when the field closes, however it closed. */
  onDone?: () => void;
  /** Given when a title can be taken away — a `title` property can; a filename cannot. */
  onClear?: () => void;
  /** How the field is drawn: a page's title by default, a tab's name in a tab strip. */
  inputClassName?: string;
}) {
  const [editingHere, setEditingHere] = useState(false);
  const [draft, setDraft] = useState(value);
  const editing = editingHere || editingFromOutside;

  const close = () => {
    setEditingHere(false);
    onDone?.();
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="page-head__title-button"
        title={hint}
        onClick={() => {
          setDraft(value);
          setEditingHere(true);
        }}
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    close();
    if (draft.trim() === '') onClear?.();
    else if (draft !== value) onCommit(draft);
  };

  return (
    <input
      className={inputClassName}
      aria-label={label}
      // The field exists because the title was just pressed, so focusing it is
      // what the press asked for.
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          // Answered here: leaving the title must not close the peek round the page too.
          event.preventDefault();
          close();
        }
      }}
    />
  );
}
