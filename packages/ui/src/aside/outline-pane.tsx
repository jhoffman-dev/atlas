import type { NodePath, OutlineHeading } from '@atlas/domain';

/**
 * The aside's Outline tab: the note's headings in order (`outlineOf`), each
 * stepped in by its depth under the shallowest, and a click asks the app to
 * scroll the editor to it. The pane holds no state: the headings come from
 * the document, and where to scroll is the editor's to know.
 */
export function OutlinePane({
  headings,
  onJump,
}: {
  headings: readonly OutlineHeading[];
  /** Scrolls to the heading at this path in the document. */
  onJump: (at: NodePath) => void;
}) {
  if (headings.length === 0) {
    return (
      <nav className="aside-outline" aria-label="Outline">
        <p className="aside__empty">No headings yet.</p>
      </nav>
    );
  }
  const top = Math.min(...headings.map((heading) => heading.level));
  return (
    <nav className="aside-outline" aria-label="Outline">
      <ul className="aside-outline__list">
        {headings.map((heading) => (
          <li
            key={heading.at.join('.')}
            className="aside-outline__item"
            data-depth={heading.level - top}
          >
            <button
              type="button"
              className="aside-outline__heading"
              onClick={() => onJump(heading.at)}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
