import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { HighlightView } from '@dfai/domain';

/*
 * A highlight drawn as what it is (#523): the source's words as a quote in
 * its mark's pastel — a highlight's fill or an underline — and the person's
 * comment under it. The hidden marker and the `^id` are never drawn. Shared
 * by the highlight in its own note, whose comment is a field, and by an
 * embed of it, where it is read-only.
 */

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
  return (
    <div className="highlight-quote" data-mark={view.mark} data-color={view.color}>
      <blockquote className="highlight-quote__quote">
        {view.picture !== null && <QuotePicture src={view.picture} loadImage={loadImage} />}
        {view.words !== '' && <span className="highlight-quote__words">{view.words}</span>}
      </blockquote>
      {comment}
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
 * back as it was. A write that is refused — unsaved typing elsewhere in the
 * note, a note changed meanwhile — keeps what was typed and says why.
 */
export function HighlightCommentField({
  comment,
  onSave,
}: {
  comment: string;
  /** Writes the comment; rejects with why it could not. */
  onSave: (comment: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(comment);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Escape leaves the field as well as putting it back: that blur writes nothing.
  const reverted = useRef(false);

  const save = () => {
    if (reverted.current) {
      reverted.current = false;
      return;
    }
    if (saving || draft === comment) return;
    setSaving(true);
    onSave(draft)
      .then(() => setProblem(null))
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setSaving(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(comment);
      setProblem(null);
      reverted.current = true;
      event.currentTarget.blur();
    }
  };

  return (
    <div className="highlight-quote__comment-field">
      <textarea
        className="highlight-quote__comment highlight-quote__input"
        aria-label="Comment on this highlight"
        placeholder="Add a comment"
        rows={Math.max(1, draft.split('\n').length)}
        value={draft}
        readOnly={saving}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
      />
      {problem !== null && (
        <p className="highlight-quote__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
