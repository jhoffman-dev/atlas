import type { MouseEvent } from 'react';
import { Icon } from './icon.tsx';

/**
 * The star that makes a note a favourite, or stops it being one.
 *
 * Its name says what pressing it will do rather than what the note currently
 * is, so it is unambiguous read on its own — which is how a screen reader
 * reaches it. That also means no `aria-pressed`: the name already carries the
 * state, and both together are announced twice.
 */
export function FavoriteStar({
  name,
  favorite,
  onToggle,
  tabbable = true,
}: {
  /** What the star is about, so its name says which note it will change. */
  name: string;
  favorite: boolean;
  onToggle: () => void;
  /**
   * False inside a roving tabindex, where only the focused row's star is a tab
   * stop — otherwise a screenful of rows is a screenful of presses to get past.
   */
  tabbable?: boolean;
}) {
  const action = favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`;

  return (
    <button
      type="button"
      className={favorite ? 'star star--on' : 'star'}
      aria-label={action}
      title={action}
      tabIndex={tabbable ? 0 : -1}
      onClick={(event: MouseEvent) => {
        // The row behind the star opens the note; pressing the star is not
        // also a press on the row.
        event.stopPropagation();
        onToggle();
      }}
    >
      <Icon name="star" size={16} className="star__glyph" />
    </button>
  );
}
