import { Icon } from '../icon.tsx';
import type { PreviewPlacement } from './preview-placement.ts';

/** What a preview card says about the note a link points at. */
export interface LinkPreview {
  readonly title: string;
  /** Its type and where it belongs, "Task · Phase 16"; null when it has neither. */
  readonly kicker: string | null;
  /** Its first lines, cut to four by the card; null while they are read, or when there are none. */
  readonly excerpt: string | null;
}

/**
 * The card a wikilink or a relation value shows after the pointer rests on it
 * (brief §5.5, FlowPeek.dc.html): 360px, the note's title and type, up to
 * four of its first lines, and what a click does.
 *
 * A tooltip, never focused and never in the way: the pointer passes through
 * it, so it cannot keep itself open or hide what is under it.
 */
export function LinkPreviewCard({
  preview,
  placement,
}: {
  preview: LinkPreview;
  placement: PreviewPlacement;
}) {
  return (
    <div className="link-preview" role="tooltip" style={placement}>
      <div className="link-preview__head">
        <Icon name="doc" size={14} className="link-preview__icon" />
        <span className="link-preview__title">{preview.title}</span>
        {preview.kicker !== null && <span className="link-preview__kicker">{preview.kicker}</span>}
      </div>
      {preview.excerpt !== null && preview.excerpt.trim() !== '' && (
        <p className="link-preview__excerpt">{preview.excerpt}</p>
      )}
      <div className="link-preview__hints" aria-hidden="true">
        <span>Click to peek</span>
        <span>⌘-click new tab</span>
        <span>⌘⇧-click split</span>
      </div>
    </div>
  );
}
