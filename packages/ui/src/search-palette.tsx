import { Dialog } from '@base-ui/react/dialog';
import { createVaultPath, placeCrumb, type PaletteCommand } from '@atlas/domain';
import type { SearchHit } from '@atlas/application';
import { Icon, sidebarGlyph } from './icon.tsx';
import { isImeKey } from './ime.ts';
import { Key, KeyHints } from './key-hints.tsx';
import { useReturnFocus, type FocusFallback } from './return-focus.ts';
import { Toggle } from './toggle.tsx';
import type { ArchivedToggle } from './view-toolbar.tsx';

const HINTS = [
  ['↑ ↓', 'to move'],
  ['↵', 'to open'],
  ['esc', 'to close'],
] as const;

/** Splits a snippet on the markers the index puts around matching words. */
function highlight(snippet: string) {
  return snippet.split(/(<<[^>]*>>)/).map((part, index) =>
    part.startsWith('<<') && part.endsWith('>>') ? (
      <mark key={index} className="palette__mark">
        {part.slice(2, -2)}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/**
 * Full-text search over the vault, driven from the keyboard.
 *
 * Mounted only while it is open, so the dialog is held open and closing is the
 * parent's business. Focus trapping, focus restoration, Escape, the scroll lock
 * and the portal are Base UI's — see ADR-0015.
 *
 * The viewport carries `palette__backdrop` rather than `Dialog.Backdrop`: that
 * class is both the scrim and the flexbox that centres the palette, and the
 * viewport is the part that wraps the popup.
 */
export function SearchPalette({
  query,
  hits,
  selected,
  onQuery,
  onMove,
  onPick,
  onClose,
  fallbackFocus,
  commands = [],
  onCommand = () => undefined,
  archived,
}: {
  query: string;
  hits: readonly SearchHit[];
  selected: number;
  onQuery: (query: string) => void;
  onMove: (delta: number) => void;
  onPick: (path: string) => void;
  onClose: () => void;
  /** Where focus goes on close if what opened the palette has gone. */
  fallbackFocus?: FocusFallback;
  /** What the query names that the palette can do, listed above the notes. */
  commands?: readonly PaletteCommand[];
  onCommand?: (id: string) => void;
  /** "Include archived": whether the search reaches the Archive too; left out, it is not offered. */
  archived?: ArchivedToggle;
}) {
  const finalFocus = useReturnFocus(fallbackFocus);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Viewport className="palette__backdrop">
          <Dialog.Popup className="palette" finalFocus={finalFocus} aria-label="Search notes">
            <div className="palette__field">
              <Icon name="search" size={19} className="palette__field-icon" />
              <input
                className="palette__input"
                type="search"
                placeholder="Search the vault…"
                aria-label="Search the vault"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    onMove(1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    onMove(-1);
                  } else if (event.key === 'Enter' && !isImeKey(event)) {
                    event.preventDefault();
                    const command = commands[selected];
                    const hit = hits[selected - commands.length];
                    if (command !== undefined) onCommand(command.id);
                    else if (hit !== undefined) onPick(hit.path);
                  }
                }}
              />
              <span aria-hidden="true">
                <Key>esc</Key>
              </span>
            </div>
            {archived !== undefined && (
              <label className="palette__scope">
                <Toggle
                  label="Include archived"
                  checked={archived.included}
                  onChange={archived.onChange}
                />
                <span aria-hidden="true">Include archived</span>
              </label>
            )}

            {query.trim() !== '' && hits.length === 0 && commands.length === 0 ? (
              <p className="palette__empty">Nothing matches.</p>
            ) : (
              <ul className="palette__hits" role="listbox" aria-label="Results">
                {commands.map((command, index) => (
                  <li key={command.id}>
                    <CommandRow
                      command={command}
                      selected={index === selected}
                      onRun={() => onCommand(command.id)}
                    />
                  </li>
                ))}
                {hits.map((hit, index) => (
                  <li key={hit.path}>
                    <Hit
                      hit={hit}
                      selected={index + commands.length === selected}
                      onPick={onPick}
                    />
                  </li>
                ))}
              </ul>
            )}
            <KeyHints hints={HINTS} />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Something to do rather than a note to open: a plus in the kind's tile, and its name. */
function CommandRow({
  command,
  selected,
  onRun,
}: {
  command: PaletteCommand;
  selected: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={selected ? 'palette__hit palette__hit--on' : 'palette__hit'}
      onMouseDown={(event) => {
        event.preventDefault();
        onRun();
      }}
    >
      <span className="palette__kind" aria-hidden="true">
        <Icon name="plus" size={16} />
      </span>
      <span className="palette__text">
        <span className="palette__title">{command.label}</span>
      </span>
      {selected && (
        <span className="palette__enter" aria-hidden="true">
          <Key>↵</Key>
        </span>
      )}
    </button>
  );
}

/**
 * One result: what kind of note it is and where it lives (never `.atlas/…`),
 * its title, and the words around the match.
 */
function Hit({
  hit,
  selected,
  onPick,
}: {
  hit: SearchHit;
  selected: boolean;
  onPick: (path: string) => void;
}) {
  const place = placeCrumb(createVaultPath(hit.path));
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={selected ? 'palette__hit palette__hit--on' : 'palette__hit'}
      onMouseDown={(event) => {
        event.preventDefault();
        onPick(hit.path);
      }}
    >
      <span className="palette__kind">
        <Icon name={sidebarGlyph(place.icon)} size={16} />
      </span>
      <span className="palette__text">
        <span className="palette__title">{hit.title}</span>
        <span className="palette__detail">
          <span className="palette__place">{place.parent}</span>
          {hit.snippet !== '' && <span className="palette__snippet">{highlight(hit.snippet)}</span>}
        </span>
      </span>
      {selected && (
        <span className="palette__enter" aria-hidden="true">
          <Key>↵</Key>
        </span>
      )}
    </button>
  );
}
