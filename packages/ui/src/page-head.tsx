import { useState, type ReactNode } from 'react';
import type { SidebarIcon } from '@atlas/domain';
import { Icon, sidebarGlyph } from './icon.tsx';

/**
 * The top of every page — note, view, dashboard or type: the icon tile, the
 * title, an optional line saying what the page is, and a slot on the right.
 *
 * The slot is where a page's own controls go (view tabs, a segmented range,
 * "New"), so pages differ only in what they put there and below, never in how
 * they are headed.
 */
export interface PageHeadProps {
  /** The page's glyph — the same one its sidebar row carries. */
  icon: SidebarIcon;
  /** The title, or an `EditableTitle` when it can be changed in place. */
  title: ReactNode;
  /** One line under the title, in the secondary ink. */
  description?: string | null;
  /**
   * `note` is a reading page: a larger tile and title, stacked, as in
   * Note.dc.html. `page` is a view, dashboard or type: tile beside the title,
   * as in Board.dc.html.
   */
  size?: 'page' | 'note';
  /** Right of the title: view tabs, segmented controls, actions. */
  actions?: ReactNode;
  /** Below the title row, full width: a toolbar that belongs to the head. */
  children?: ReactNode;
}

export function PageHead({
  icon,
  title,
  description = null,
  size = 'page',
  actions,
  children,
}: PageHeadProps) {
  return (
    <header className={`page-head page-head--${size}`}>
      <div className="page-head__row">
        <span className="page-head__tile" aria-hidden="true">
          <Icon name={sidebarGlyph(icon)} size={size === 'note' ? 30 : 26} />
        </span>
        <div className="page-head__titles">
          <h1 className="page-head__title">{title}</h1>
          {description !== null && description !== '' && (
            <p className="page-head__description">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="page-head__actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
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
        if (event.key === 'Escape') close();
      }}
    />
  );
}
