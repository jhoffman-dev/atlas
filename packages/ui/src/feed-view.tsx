import { useCallback, useMemo, useState } from 'react';
import {
  bodyWithoutTitle,
  noteExcerpt,
  plainText,
  type BoardRow,
  type EditorDocument,
  type PropertyKind,
} from '@atlas/domain';
import type { CoverSource } from './card-cover.tsx';
import { DoneCheckbox, doneClass, type DoneTicks } from './done-checkbox.tsx';
import { NoteFields } from './note-fields.tsx';
import { NoteReading } from './note-reading.tsx';

/** The notes' bodies, read from their files as the feed reaches them. */
export interface FeedBodies {
  /** A note's body, once read; undefined while it is being read, or when it cannot be. */
  readonly bodyOf: (path: string) => EditorDocument | undefined;
  /** Something the webview can show for an image in a note. */
  readonly load: CoverSource['load'];
}

/**
 * The same query as a reading stream: each note as a wide card with its
 * fields and its body, so a run of meeting notes or a journal reads without
 * opening each one. The order is the query's — newest first unless the view
 * sorts otherwise.
 */
export function FeedView({
  rows,
  fields,
  kinds = {},
  bodies,
  shown,
  onShowMore,
  onOpenNote,
  onFollowLink,
  onOpenTag,
  ticks,
}: {
  rows: readonly BoardRow[];
  fields: readonly string[];
  kinds?: Readonly<Record<string, PropertyKind>>;
  bodies: FeedBodies;
  /** How many notes are drawn; the rest wait behind "Show more notes". */
  shown: number;
  onShowMore: () => void;
  onOpenNote: (path: string) => void;
  /** Follows a `[[link]]` in a body. */
  onFollowLink: (target: string) => void;
  /** Opens the tags page on a `#tag` in a body. */
  onOpenTag?: (name: string) => void;
  ticks?: DoneTicks;
}) {
  if (rows.length === 0) return <p className="table__empty">Nothing matches this view yet.</p>;

  return (
    <div className="feed">
      <ul className="feed__list" aria-label="Notes">
        {rows.slice(0, shown).map((row) => (
          <li key={row.path} className={doneClass('feed__card', ticks, row.values)}>
            <FeedCard
              row={row}
              fields={fields}
              kinds={kinds}
              bodies={bodies}
              onOpenNote={onOpenNote}
              onFollowLink={onFollowLink}
              {...(onOpenTag !== undefined && { onOpenTag })}
              {...(ticks !== undefined && { ticks })}
            />
          </li>
        ))}
      </ul>
      {rows.length > shown && (
        <button type="button" className="feed__more" onClick={onShowMore}>
          Show more notes
        </button>
      )}
    </div>
  );
}

function FeedCard({
  row,
  fields,
  kinds,
  bodies,
  onOpenNote,
  onFollowLink,
  onOpenTag,
  ticks,
}: {
  row: BoardRow;
  fields: readonly string[];
  kinds: Readonly<Record<string, PropertyKind>>;
  bodies: FeedBodies;
  onOpenNote: (path: string) => void;
  onFollowLink: (target: string) => void;
  onOpenTag?: (name: string) => void;
  ticks?: DoneTicks;
}) {
  return (
    <article aria-label={row.title}>
      <header className="feed__head">
        {ticks !== undefined && (
          <DoneCheckbox path={row.path} title={row.title} values={row.values} ticks={ticks} />
        )}
        <h2 className="feed__heading">
          <button type="button" className="feed__title" onClick={() => onOpenNote(row.path)}>
            {row.title}
          </button>
        </h2>
      </header>
      <NoteFields row={row} fields={fields} kinds={kinds} className="feed__fields" />
      <FeedBody
        row={row}
        bodies={bodies}
        onFollowLink={onFollowLink}
        {...(onOpenTag !== undefined && { onOpenTag })}
      />
    </article>
  );
}

/**
 * A note's body in the feed: its opening blocks, and all of it on "Show more".
 * Until the file has been read, what the index knows it is about stands in.
 */
function FeedBody({
  row,
  bodies,
  onFollowLink,
  onOpenTag,
}: {
  row: BoardRow;
  bodies: FeedBodies;
  onFollowLink: (target: string) => void;
  onOpenTag?: (name: string) => void;
}) {
  const [whole, setWhole] = useState(false);
  const { load } = bodies;
  const loadImage = useCallback((src: string) => load({ path: row.path, src }), [load, row.path]);
  const read = bodies.bodyOf(row.path);
  // Kept between renders: a new document object would be redrawn from scratch.
  const shown = useMemo(() => {
    if (read === undefined) return null;
    const body = bodyWithoutTitle(read, row.title);
    return { body, excerpt: noteExcerpt(body) };
  }, [read, row.title]);

  if (shown === null) {
    const summary = typeof row.values['summary'] === 'string' ? row.values['summary'] : '';
    return summary === '' ? null : <p className="feed__summary">{plainText(summary)}</p>;
  }

  return (
    <div className="feed__body">
      <NoteReading
        doc={whole ? shown.body : shown.excerpt.doc}
        label={`Body of ${row.title}`}
        onFollowLink={onFollowLink}
        {...(onOpenTag !== undefined && { onOpenTag })}
        loadImage={loadImage}
      />
      {shown.excerpt.clipped && (
        <button
          type="button"
          className="feed__toggle"
          aria-expanded={whole}
          onClick={() => setWhole(!whole)}
        >
          {whole ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
