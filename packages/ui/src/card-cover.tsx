import { useEffect, useState, type ReactNode } from 'react';

/** Where a card's picture comes from: which image a note is fronted with, and its bytes. */
export interface CoverSource {
  /** The image a note names or opens with, as written in it; null when it has none. */
  readonly coverOf: (path: string) => string | null;
  /** Something the webview can show for an image written in a note, or null when it cannot. */
  readonly load: (args: { path: string; src: string }) => Promise<string | null>;
}

/**
 * A card's picture. Nothing is drawn until there is one to draw: a note with
 * no cover, or one whose image cannot be read, is a card without a picture
 * rather than a card with a hole in it — or with `fallback` in its place.
 */
export function CardCover({
  path,
  covers,
  fallback = null,
}: {
  path: string;
  covers: CoverSource;
  /** Drawn where there is no picture to draw — an artifact's kind and title, say. */
  fallback?: ReactNode;
}) {
  const src = covers.coverOf(path);
  const [shown, setShown] = useState<{ src: string; url: string | null } | null>(null);

  useEffect(() => {
    if (src === null) return;
    let cancelled = false;
    void covers.load({ path, src }).then((url) => {
      if (!cancelled) setShown({ src, url });
    });
    return () => {
      cancelled = true;
    };
  }, [covers, path, src]);

  // A cover changed in the note leaves the old picture until the new one loads,
  // never the old picture under the new name.
  if (src === null || shown === null || shown.src !== src || shown.url === null) return fallback;
  return <img className="card-cover" src={shown.url} alt="" />;
}
