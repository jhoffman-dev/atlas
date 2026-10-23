import {
  createContext,
  useContext,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { HighlightView } from '@dfai/domain';
import type { HighlightDrafts, WriteComment } from './highlight-drafts.ts';

/*
 * A highlight drawn as what it is (#523): the source's words as a quote in
 * its mark's pastel — a highlight's fill or an underline — and the person's
 * comment under it. The hidden marker and the `^id` are never drawn. Shared
 * by the highlight in its own note, whose comment is a field, and by an
 * embed of it, where it is read-only.
 */

/** The quote's element, which a comment field in it is described by. */
const QuoteIdContext = createContext<string | undefined>(undefined);

/** The quote, then `comment`: the field in the note, the words in an embed. */
export function HighlightQuote({
  view,
  loadImage,
  comment,
}: {
  view: HighlightView;
  loadImage: (src: string) => Promise<string | null>;
  comment: ReactNode;
}) {
  const quoteId = useId();
  return (
    <div className="highlight-quote" data-mark={view.mark} data-color={view.color}>
      <blockquote className="highlight-quote__quote" id={quoteId}>
        {view.picture !== null && <QuotePicture src={view.picture} loadImage={loadImage} />}
        {view.words !== '' && <span className="highlight-quote__words">{view.words}</span>}
      </blockquote>
      <QuoteIdContext.Provider value={quoteId}>{comment}</QuoteIdContext.Provider>
    </div>
  );
}

/** A comment as it reads, where it cannot be edited: an embed's. */
export function HighlightComment({ comment }: { comment: string }) {
  return comment === '' ? null : <p className="highlight-quote__comment">{comment}</p>;
}

/** An area highlight's picture of its passage, found as the note's images are. */
function QuotePicture({
  src,
  loadImage,
}: {
  src: string;
  loadImage: (src: string) => Promise<string | null>;
}) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadImage(src)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadImage, src]);
  if (url === undefined) return null;
  if (url === null) {
    return (
      <span className="highlight-quote__missing" title={src}>
        Missing picture: {src}
      </span>
    );
  }
  return <img className="highlight-quote__picture" src={url} alt="The highlighted area" />;
}

/**
 * The comment of a highlight in its own note, typed in place. It is written
 * when the field is left or on ⌘↩, and only when it changed; Escape puts it
 * back as it is on disk. The words typed are kept by `drafts`, so a note read
 * again under the field, or the field drawn again, does not lose them. A write
 * that is refused keeps them and says why; one refused because the comment
 * changed meanwhile (a sync, Obsidian) shows the comment now there and lets
 * the person choose theirs or the note's.
 */
export function HighlightCommentField({
  id,
  comment,
  drafts,
  onSave,
}: {
  id: string;
  /** The comment on disk, as the note was last read. */
  comment: string;
  drafts: HighlightDrafts;
  /** Writes the comment over the one it started from; rejects with why it could not. */
  onSave: WriteComment;
}) {
  const quoteId = useContext(QuoteIdContext);
  const input = useRef<HTMLTextAreaElement>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const draft = drafts.of(id, comment);
  // Escape leaves the field as well as putting it back: that blur writes nothing.
  const reverted = useRef(false);

  useEffect(() => {
    if (drafts.follow(id, comment)) redraw();
  }, [drafts, id, comment]);

  // A write the pane began (every pane's work written) settles here too.
  useEffect(() => drafts.watch(id, redraw), [drafts, id]);

  // A field drawn again while the person is in it takes them back to where they were.
  useEffect(() => {
    const element = input.current;
    const place = drafts.focus;
    if (
      element !== null &&
      place !== null &&
      place.id === id &&
      document.activeElement !== element
    ) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(place.start, place.end);
    }
    return () => drafts.release(id);
  }, [drafts, id]);

  const save = () => {
    if (reverted.current) {
      reverted.current = false;
      return;
    }
    const writing = drafts.write(id, onSave);
    redraw();
    void writing.then(redraw);
  };

  const useMine = () => {
    if (drafts.useMine(id)) save();
  };

  const keepTheirs = () => {
    drafts.keepTheirs(id);
    redraw();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An input method's Escape cancels its candidate and its Return confirms it: neither is ours.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      reverted.current = true;
      drafts.revert(id, comment);
      redraw();
      event.currentTarget.blur();
    }
  };

  const message = draft.problem;
  return (
    <div className="highlight-quote__comment-field">
      <textarea
        ref={input}
        className="highlight-quote__comment highlight-quote__input"
        aria-label="Comment on this highlight"
        aria-describedby={quoteId}
        placeholder="Add a comment"
        rows={Math.max(1, draft.text.split('\n').length)}
        value={draft.text}
        onChange={(event) => {
          drafts.type(id, event.currentTarget.value);
          redraw();
        }}
        onFocus={(event) => {
          const { selectionStart, selectionEnd } = event.currentTarget;
          drafts.rememberFocus(id, selectionStart, selectionEnd);
        }}
        onSelect={(event) => {
          const { selectionStart, selectionEnd } = event.currentTarget;
          if (drafts.focus?.id === id) drafts.rememberFocus(id, selectionStart, selectionEnd);
        }}
        onBlur={(event) => {
          // A field taken off the page by a redraw is not the person leaving it.
          if (event.currentTarget.isConnected) drafts.forgetFocus(id);
          save();
        }}
        onKeyDown={onKeyDown}
      />
      {draft.conflict !== null && (
        <div className="highlight-quote__problem" role="alert">
          <p>
            This comment changed in the note while you were typing. Now it reads:{' '}
            <q className="highlight-quote__theirs">{draft.conflict}</q>
          </p>
          <button type="button" onClick={useMine}>
            Use mine
          </button>{' '}
          <button type="button" onClick={keepTheirs}>
            Keep theirs
          </button>
        </div>
      )}
      {message !== null && (
        <p className="highlight-quote__problem" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
