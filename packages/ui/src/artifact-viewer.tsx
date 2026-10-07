import { useEffect, useState } from 'react';
import { FileDrop } from './file-drop.tsx';
import { Icon } from './icon.tsx';

/** The saved copy, as far as the viewer is concerned. */
export type ArtifactViewerCopy =
  | { readonly kind: 'loading' }
  /** Only the link is kept. */
  | { readonly kind: 'none' }
  /** The note names a copy that is not there. */
  | { readonly kind: 'missing' }
  /** One document with everything it uses written into it. */
  | { readonly kind: 'ready'; readonly page: string };

/**
 * The frame's sandbox: scripts may run, and nothing else. Without
 * `allow-same-origin` the page has an opaque origin, so it cannot reach the
 * app, its storage or its IPC; without `allow-top-navigation`, `allow-popups`
 * or `allow-forms` it cannot take the window away, open one, or post anywhere.
 */
export const ARTIFACT_SANDBOX = 'allow-scripts';

/**
 * An artifact's saved copy, under its note's properties, in a sandboxed
 * frame — or, when there is no copy, a card saying so with the ways to get
 * one. The toolbar opens the link in the browser, lets the frame fill the
 * pane, reloads the copy from the vault, and makes the copy's thumbnail again.
 */
export function ArtifactViewer({
  title,
  url,
  copy,
  adding,
  error,
  onOpenLink,
  onReload,
  onAddCopy,
  thumbnail,
}: {
  title: string;
  /** The artifact's link, or null when the note has none. */
  url: string | null;
  copy: ArtifactViewerCopy;
  /** True while dropped files are being saved as the copy. */
  adding: boolean;
  /** Why the last attempt to add a copy was refused. */
  error: string | null;
  onOpenLink: () => void;
  onReload: () => void;
  onAddCopy: (files: File[]) => void;
  /** Given where a thumbnail can be made: whether one is being made, and making it again. */
  thumbnail?: { readonly generating: boolean; readonly onRegenerate: () => void };
}) {
  const [full, setFull] = useState(false);
  // Escape gives the pane back; the frame itself cannot hear it once focused.
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <section
      className={full ? 'artifact-viewer artifact-viewer--full' : 'artifact-viewer'}
      aria-label="Saved copy"
    >
      <div className="artifact-viewer__bar">
        <span className="artifact-viewer__label">
          <Icon name="artifact" size={15} />
          {copy.kind === 'ready' ? 'Saved copy' : 'No saved copy'}
        </span>
        <div className="artifact-viewer__actions">
          {url !== null && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenLink}>
              <Icon name="link" size={14} />
              Open link
            </button>
          )}
          {copy.kind === 'ready' && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-pressed={full}
                onClick={() => setFull(!full)}
              >
                {full ? 'Exit full screen' : 'Full screen'}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onReload}>
                Reload
              </button>
              {thumbnail !== undefined && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={thumbnail.generating}
                  onClick={thumbnail.onRegenerate}
                >
                  {thumbnail.generating ? 'Generating thumbnail…' : 'Regenerate thumbnail'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <ViewerBody
        title={title}
        copy={copy}
        url={url}
        adding={adding}
        error={error}
        onOpenLink={onOpenLink}
        onAddCopy={onAddCopy}
      />
    </section>
  );
}

function ViewerBody({
  title,
  copy,
  url,
  adding,
  error,
  onOpenLink,
  onAddCopy,
}: {
  title: string;
  copy: ArtifactViewerCopy;
  url: string | null;
  adding: boolean;
  error: string | null;
  onOpenLink: () => void;
  onAddCopy: (files: File[]) => void;
}) {
  if (copy.kind === 'loading') return <div className="artifact-viewer__frame" aria-busy="true" />;
  if (copy.kind === 'ready') {
    return (
      <iframe
        className="artifact-viewer__frame"
        title={`Saved copy of ${title}`}
        sandbox={ARTIFACT_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={copy.page}
      />
    );
  }
  return (
    <div className="artifact-viewer__empty">
      <FileDrop label="Drop the page here" disabled={adding} onFiles={onAddCopy}>
        <p className="artifact-viewer__empty-title">
          {copy.kind === 'missing' ? 'The saved copy is missing' : 'Only the link is saved'}
        </p>
        <p className="artifact-viewer__empty-text">
          {adding
            ? 'Saving the copy…'
            : 'Add a copy: drop the page’s HTML file here, or ask Claude to save one.'}
        </p>
        {url !== null && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={onOpenLink}>
            Open link
          </button>
        )}
      </FileDrop>
      {error !== null && (
        <p className="new-type__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
