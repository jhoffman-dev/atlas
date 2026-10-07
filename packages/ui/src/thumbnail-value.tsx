import { useEffect, useRef, useState } from 'react';
import { IMAGE_PICKER_ACCEPT } from '@atlas/domain';

/**
 * A Thumbnail property: the picture itself, small, rather than the path it
 * is kept at, with Regenerate and Clear beside it — and, where offered,
 * Choose image…. Regenerate pictures the page again (an artifact's saved
 * copy, or the note's own page) and makes that the thumbnail, whatever it
 * was; Clear takes it off; Choose image… makes a picture from the vault it.
 */
export function ThumbnailValue({
  id,
  cover,
  shown,
  generating,
  failure,
  canGenerate,
  load,
  onRegenerate,
  regenerateDiscards = null,
  onClear,
  onChoose,
  clearable = cover !== null,
  emptyLabel = 'None yet',
}: {
  /** The id the row's label points at. */
  id: string;
  /** The cover as the note holds it; null for none. */
  cover: string | null;
  /**
   * What to load for it — the cover, changed each time it is made again, so a
   * picture remade under the same name is not the one already on screen.
   */
  shown: string | null;
  generating: boolean;
  /** Why the last try to make one failed; null when it did not. */
  failure: string | null;
  /** Whether there is a copy to picture. */
  canGenerate: boolean;
  /** Something the webview can show for an image written in the note, or null. */
  load: (src: string) => Promise<string | null>;
  onRegenerate: () => void;
  /**
   * The picture Regenerate would put out of the note for good — one only the
   * note remembers, such as a web address. Given, Regenerate asks first.
   */
  regenerateDiscards?: string | null;
  onClear: () => void;
  /** Takes a picture the person picked; without it, Choose image… is not offered. */
  onChoose?: (file: File) => void;
  /** Whether there is a thumbnail to take off; by default, whether there is a cover. */
  clearable?: boolean;
  /** What the frame says when there is no picture and none is being made. */
  emptyLabel?: string;
}) {
  const url = useLoaded(shown, load);
  const picker = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const regenerate = () => {
    if (regenerateDiscards === null) onRegenerate();
    else setAsking(true);
  };
  return (
    <div className="thumbnail-value" id={id} aria-busy={generating}>
      <div className="thumbnail-value__frame">
        {url !== null && !generating ? (
          <img className="thumbnail-value__image" src={url} alt={`Thumbnail: ${cover ?? ''}`} />
        ) : (
          <span className="thumbnail-value__empty">
            {generating ? 'Generating…' : cover === null ? emptyLabel : 'Not found'}
          </span>
        )}
      </div>
      <div className="thumbnail-value__actions">
        {canGenerate && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={generating}
            onClick={regenerate}
          >
            {cover === null ? 'Generate' : 'Regenerate'}
          </button>
        )}
        {onChoose !== undefined && (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={generating}
              onClick={() => picker.current?.click()}
            >
              Choose image…
            </button>
            <input
              ref={picker}
              hidden
              type="file"
              accept={IMAGE_PICKER_ACCEPT}
              aria-label="Choose a thumbnail image"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file !== undefined) onChoose(file);
              }}
            />
          </>
        )}
        {clearable && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={generating}
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>
      {asking && regenerateDiscards !== null && (
        <RegenerateAsk
          id={`${id}-ask`}
          discards={regenerateDiscards}
          onReplace={() => {
            setAsking(false);
            onRegenerate();
          }}
          onKeep={() => setAsking(false)}
        />
      )}
      {failure !== null && !generating && (
        <span className="props__error" role="alert">
          No thumbnail: {failure}
        </span>
      )}
    </div>
  );
}

/** Asks before Regenerate replaces a picture the vault does not keep. */
function RegenerateAsk({
  id,
  discards,
  onReplace,
  onKeep,
}: {
  id: string;
  discards: string;
  onReplace: () => void;
  onKeep: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  // The decision is the next thing to do, so it takes the keyboard.
  useEffect(() => first.current?.focus(), []);
  return (
    <div
      className="thumbnail-value__ask"
      role="alertdialog"
      aria-label="Replace the thumbnail"
      aria-describedby={id}
    >
      <p id={id}>
        Regenerate replaces {discards}, which is not kept in the vault and cannot be brought back.
      </p>
      <div className="thumbnail-value__actions">
        <button ref={first} type="button" className="btn btn--primary btn--sm" onClick={onReplace}>
          Replace it
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onKeep}>
          Keep it
        </button>
      </div>
    </div>
  );
}

/** The loaded picture for `src`, or null until it loads, when it will not, or when there is none. */
function useLoaded(
  src: string | null,
  load: (src: string) => Promise<string | null>,
): string | null {
  const [loaded, setLoaded] = useState<{ src: string; url: string | null } | null>(null);
  useEffect(() => {
    if (src === null) return;
    let cancelled = false;
    void load(src).then((url) => {
      if (!cancelled) setLoaded({ src, url });
    });
    return () => {
      cancelled = true;
    };
  }, [src, load]);
  return src !== null && loaded?.src === src ? loaded.url : null;
}
