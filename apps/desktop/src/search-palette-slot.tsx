import { memo, useMemo } from 'react';
import type { NavigationPlace, PaletteCommand } from '@atlas/domain';
import type { IndexPort } from '@atlas/application';
import { SearchPalette } from '@atlas/ui';
import { useSearch } from './index/use-search.ts';
import { hideOverlay, useOverlayUp, type OverlayStore } from './overlay-store.ts';
import { useFocusedPlace, type WorkspaceStore } from './workspace/workspace-store.ts';

/**
 * The search palette, drawn while ⌘K has it up. It watches the overlay store
 * for itself and keeps its query there, so opening it and typing into it
 * draws only the palette, not the window behind it (#261). Drawn with `memo`,
 * and handed steady handlers, so the window drawn again does not draw it.
 */
export const SearchPaletteSlot = memo(function SearchPaletteSlot(props: SearchPaletteSlotProps) {
  const up = useOverlayUp(props.store, 'search');
  return up ? <OpenSearchPalette {...props} /> : null;
});

export interface SearchPaletteSlotProps {
  readonly store: OverlayStore;
  readonly workspace: WorkspaceStore;
  readonly index: IndexPort;
  /**
   * The commands on offer, given the place the focused pane shows: a note
   * can be archived or unarchived from here. Read while the palette is up,
   * so the window is not drawn for a switch between notes.
   */
  readonly commandsFor: (focused: NavigationPlace | null) => readonly PaletteCommand[];
  /** Commands the query itself calls for — a pasted link, say — listed first. */
  readonly offerFor: (query: string) => readonly PaletteCommand[];
  /** Changes whenever the index does: see `useSearch`. */
  readonly changeKey: string;
  /** A command chosen, once the palette has closed, with the query it was chosen from. */
  readonly onCommand: (id: string, query: string) => void;
  /** A note chosen, once the palette has closed. */
  readonly onPick: (path: string) => void;
  readonly fallbackFocus: () => HTMLElement | null;
}

function OpenSearchPalette({
  store,
  workspace,
  index,
  commandsFor,
  offerFor,
  changeKey,
  onCommand,
  onPick,
  fallbackFocus,
}: SearchPaletteSlotProps) {
  const focused = useFocusedPlace(workspace);
  const commands = useMemo(() => commandsFor(focused), [commandsFor, focused]);
  const search = useSearch({ index, commands, offerFor, changeKey, store });
  return (
    <SearchPalette
      query={search.query}
      commands={search.commands}
      archived={{ included: search.includeArchived, onChange: search.setIncludeArchived }}
      onCommand={(id) => {
        // Closing forgets the query (`withClosed`); this render's is the one chosen from.
        hideOverlay(store, 'search');
        onCommand(id, search.query);
      }}
      hits={search.hits}
      selected={search.selected}
      onQuery={search.setQuery}
      onMove={search.move}
      onPick={(path) => {
        hideOverlay(store, 'search');
        onPick(path);
      }}
      onClose={() => hideOverlay(store, 'search')}
      fallbackFocus={fallbackFocus}
    />
  );
}
