import { Icon } from './icon.tsx';
import { artifactKindGlyph } from './new-artifact-dialog.tsx';

/**
 * The front of an artifact's card while it has no picture: its kind's glyph
 * over its title, on a tinted panel the size of a cover — and, while its
 * thumbnail is being made, a quiet word saying so. The picture itself is made
 * outside the app (`page_snapshot.rs`); the gallery never runs an artifact.
 */
export function ArtifactCardFace({
  kind,
  title,
  generating = false,
}: {
  kind: string;
  title: string;
  generating?: boolean;
}) {
  return (
    <div className="artifact-face" data-kind={kind} aria-busy={generating}>
      <Icon name={artifactKindGlyph(kind)} size={26} className="artifact-face__icon" />
      <span className="artifact-face__title" aria-hidden="true">
        {title}
      </span>
      {generating && <span className="artifact-face__status">Generating thumbnail…</span>}
    </div>
  );
}
