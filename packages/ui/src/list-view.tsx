import type { ReactNode } from 'react';
import { plainText, type BoardColumn, type BoardRow, type PropertyKind } from '@atlas/domain';
import { CardCover, type CoverSource } from './card-cover.tsx';
import { DoneCheckbox, doneClass, type DoneTicks } from './done-checkbox.tsx';
import { NoteFields } from './note-fields.tsx';

interface NotesProps {
  rows: readonly BoardRow[];
  /** The view's columns, in its order. */
  fields: readonly string[];
  /** The declared kind of each property, so a value is drawn as what it is. */
  kinds?: Readonly<Record<string, PropertyKind>>;
  onOpenNote: (path: string) => void;
  /** Given when the view's type can be ticked done: every note gets a box. */
  ticks?: DoneTicks;
}

/** What a note is about, as plain words: `code` and ~~marks~~ are markdown, not text. */
function summaryOf(row: BoardRow): string {
  const summary = row.values['summary'];
  return typeof summary === 'string' ? plainText(summary) : '';
}

/** The same query as a list: a line per note, with a few fields beside it. */
export function ListView({ rows, fields, kinds = {}, onOpenNote, ticks }: NotesProps) {
  if (rows.length === 0) return <p className="table__empty">Nothing matches this view yet.</p>;

  return (
    <ul className="list-view" aria-label="Notes">
      {rows.map((row) => {
        const summary = summaryOf(row);
        return (
          <li key={row.path} className={doneClass('list-view__row', ticks, row.values)}>
            {ticks !== undefined && (
              <DoneCheckbox path={row.path} title={row.title} values={row.values} ticks={ticks} />
            )}
            <button type="button" className="list-view__title" onClick={() => onOpenNote(row.path)}>
              {row.title}
            </button>
            {summary !== '' && <span className="list-view__summary">{summary}</span>}
            <NoteFields row={row} fields={fields} kinds={kinds} className="list-view__fields" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The same query as cards, for notes you recognise by name — or by picture:
 * a card is fronted with the note's cover when it has one.
 *
 * The title is the card's one button, stretched over the card by CSS, so a
 * click anywhere opens the note while the done box beside it stays its own
 * control; a card is one tab stop, or two with a box.
 */
export function GalleryView({
  rows,
  groups,
  placeholder,
  ...card
}: NotesProps & {
  covers?: CoverSource;
  /** Given when the view groups its cards: a heading and a grid per group that has any. */
  groups?: readonly BoardColumn[];
  /** Drawn on the front of a card with no picture. */
  placeholder?: (row: BoardRow) => ReactNode;
  /**
   * The shape of a card's front: a banner, cropped short, for any note's
   * cover; a screen, 16:10, for pictures of pages — an artifact's thumbnail.
   */
  fronts?: 'banner' | 'screen';
}) {
  if (rows.length === 0) return <p className="table__empty">Nothing matches this view yet.</p>;
  if (groups === undefined) return <GalleryGrid rows={rows} placeholder={placeholder} {...card} />;

  return (
    <div className="gallery-groups">
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.value ?? ''} className="gallery-group" aria-label={group.label}>
            <h3 className="gallery-group__label">
              {group.label}
              <span className="gallery-group__count">{group.rows.length}</span>
            </h3>
            <GalleryGrid rows={group.rows} placeholder={placeholder} {...card} />
          </section>
        ))}
    </div>
  );
}

function GalleryGrid({
  rows,
  fields,
  kinds = {},
  onOpenNote,
  ticks,
  covers,
  placeholder,
  fronts = 'banner',
}: NotesProps & {
  covers?: CoverSource | undefined;
  placeholder?: ((row: BoardRow) => ReactNode) | undefined;
  fronts?: 'banner' | 'screen' | undefined;
}) {
  return (
    <ul className={fronts === 'screen' ? 'gallery gallery--screens' : 'gallery'} aria-label="Notes">
      {rows.map((row) => {
        const summary = summaryOf(row);
        const face = placeholder?.(row) ?? null;
        return (
          <li key={row.path} className={doneClass('gallery__card', ticks, row.values)}>
            {covers !== undefined ? (
              <CardCover path={row.path} covers={covers} fallback={face} />
            ) : (
              face
            )}
            <div className="gallery__body">
              <div className="gallery__head">
                {ticks !== undefined && (
                  <DoneCheckbox
                    path={row.path}
                    title={row.title}
                    values={row.values}
                    ticks={ticks}
                  />
                )}
                <button
                  type="button"
                  className="gallery__title"
                  onClick={() => onOpenNote(row.path)}
                >
                  {row.title}
                </button>
              </div>
              {summary !== '' && <span className="gallery__summary">{summary}</span>}
              <NoteFields row={row} fields={fields} kinds={kinds} className="gallery__fields" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
