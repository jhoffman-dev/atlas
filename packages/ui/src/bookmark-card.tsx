import { Icon } from './icon.tsx';

/** What a bookmark card shows of the note it links to, as the page hands it over. */
export type BookmarkPreview =
  | {
      /** The link names no note. */
      readonly kind: 'missing';
      /** The link as it reads, to say which note is missing. */
      readonly label: string;
    }
  | {
      readonly kind: 'note';
      readonly title: string;
      readonly summary: string;
      /** Where the note lives, as its breadcrumb says it. */
      readonly place: string;
      readonly archived: boolean;
      /** The picture that fronts it, ready to display; null for the page icon. */
      readonly picture: string | null;
    };

/** Where a card is while its note is read, or when it could not be. */
export type BookmarkState = BookmarkPreview | { readonly kind: 'loading' | 'failed' };

/**
 * A link shown as a card (U-21): the note's title, a line or two of what it
 * says and where it lives, beside a picture of it — or, when it is missing,
 * a card that says so. The whole card opens the note; the "…" opens the
 * link's menu, where it can go back to being a link.
 */
export function BookmarkCard({
  label,
  state,
  onOptions,
}: {
  /** The link as it reads, shown while the note is read or when it cannot be. */
  label: string;
  state: BookmarkState;
  /** Opens the link's menu under the button; left out, the card has none (a feed). */
  onOptions?: (anchor: HTMLElement) => void;
}) {
  const note = state.kind === 'note' ? state : null;
  const title = note?.title ?? label;
  const picture = note?.picture ?? null;
  return (
    <>
      <span className="bookmark__text">
        <span className="bookmark__title" role="link">
          {title}
        </span>
        <BookmarkLine state={state} label={label} />
        <span className="bookmark__place">
          <Icon name={note === null ? 'link' : 'doc'} size={13} />
          {note?.place ?? (state.kind === 'missing' ? 'Missing note' : 'Note')}
          {note?.archived === true && <span className="bookmark__chip">Archived</span>}
        </span>
      </span>
      <span className="bookmark__picture" aria-hidden="true">
        {picture !== null ? (
          <img className="bookmark__img" src={picture} alt="" />
        ) : (
          <Icon name={state.kind === 'missing' ? 'link' : 'doc'} size={26} />
        )}
      </span>
      {onOptions !== undefined && (
        <button
          type="button"
          className="bookmark__options icon-button"
          // Named for its card: a note of several cards is not a row of identical buttons.
          aria-label={`Options for ${title}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // The card opens its note on a click; the menu is not the card.
            event.stopPropagation();
            onOptions(event.currentTarget);
          }}
        >
          <Icon name="more" size={16} />
        </button>
      )}
    </>
  );
}

/** The line under the title: the summary, or what is wrong. */
function BookmarkLine({ state, label }: { state: BookmarkState; label: string }) {
  if (state.kind === 'note') {
    return state.summary === '' ? null : <span className="bookmark__summary">{state.summary}</span>;
  }
  if (state.kind === 'loading') return null;
  const problem =
    state.kind === 'missing'
      ? `No note is called “${label}” — it may have been renamed or deleted.`
      : 'This note could not be read just now.';
  return <span className="bookmark__summary bookmark__summary--warn">{problem}</span>;
}

/** The class a card is drawn with, by what it shows and whether it is selected. */
export function bookmarkClass(state: BookmarkState, selected: boolean): string {
  const classes = ['bookmark'];
  if (state.kind === 'missing' || state.kind === 'failed') classes.push('bookmark--missing');
  if (state.kind === 'note' && state.archived) classes.push('bookmark--archived');
  if (state.kind === 'loading') classes.push('bookmark--loading');
  if (selected) classes.push('bookmark--selected');
  return classes.join(' ');
}
