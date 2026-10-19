import { memo, useMemo } from 'react';
import { useStore } from 'zustand';
import { activeTabOf, outlineOf, type TabId, type VaultPath } from '@atlas/domain';
import { BacklinksPane, OutlinePane, PropertiesPane, RightSidebar } from '@atlas/ui';
import { requestReveal } from '../panes/reveals.ts';
import { openNote } from '../workspace/open-place.ts';
import { useFocusedPlace } from '../workspace/workspace-store.ts';
import { useWorkspaceStores } from '../workspace/workspace-wiring.tsx';
import { hideAside, selectAsideTab, useAsideTab, useFocusedRow, withinOf } from './aside-store.ts';
import { ClaudeSeat } from './claude-seat.tsx';
import { RowAside, type RowPorts } from './row-aside.tsx';
import type { ShownNotes } from './shown-notes.ts';

/**
 * The right sidebar, wired (#306): it follows the focused tab through the
 * workspace store and reads what that tab shows — the row its table last
 * focused, else the note it is on — through selectors, never through props
 * from `App`, so a tick on Today or a keystroke elsewhere draws nothing here.
 * The Claude tab is the chat's seat (plan question 4). Memoised: its one
 * prop is the row's ports, which change with the vault's, so its own
 * subscriptions are what draw it.
 */
export const AsideContainer = memo(function AsideContainer({ rows }: { rows: RowPorts }) {
  const { store, aside, shown } = useWorkspaceStores();
  const tab = useAsideTab(aside);
  const activeTab = useStore(store, (state) => activeTabOf(state.workspace).id);
  const place = useFocusedPlace(store);
  const row = useFocusedRow(aside, { tab: activeTab, within: withinOf(place) });
  const notePath = place?.kind === 'note' ? place.path : null;
  // Properties is always offered, empty on a page with nothing selected, so
  // leaving a note for Today does not fall the aside through to Claude.
  const subject =
    row !== null
      ? { properties: <RowAside path={row} ports={rows} /> }
      : notePath !== null
        ? notePanels({ shown, tab: activeTab, path: notePath })
        : { properties: <NothingSelected /> };
  return (
    <RightSidebar
      tab={tab}
      panels={{ ...subject, claude: <ClaudeSeat /> }}
      onSelectTab={(next) => selectAsideTab(aside, next)}
      onHide={() => hideAside(aside)}
      onEscape={focusTheWork}
    />
  );
});

/** A note tab's panels, each reading its own slice of what the tab published. */
function notePanels({ shown, tab, path }: { shown: ShownNotes; tab: TabId; path: VaultPath }) {
  const at = { shown, tab, path };
  return {
    properties: <NoteProperties {...at} />,
    backlinks: <NoteBacklinks {...at} />,
    outline: <NoteOutline {...at} />,
  };
}

interface NotePanelProps {
  shown: ShownNotes;
  tab: TabId;
  /** The tab's note, as the workspace has it; what the tab published may lag it by a render. */
  path: VaultPath;
}

function NoteProperties({ shown, tab, path }: NotePanelProps) {
  const { store } = useWorkspaceStores();
  const note = useStore(shown, (state) => state.byTab.get(tab) ?? null);
  if (note === null || note.path !== path) return <Reading />;
  return (
    <PropertiesPane
      {...note.panel}
      context={note.kicker}
      title={note.title}
      path={note.path}
      onOpenInNewTab={() => openNote(store, note.path, 'new-tab')}
    />
  );
}

function NoteBacklinks({ shown, tab, path }: NotePanelProps) {
  const { store } = useWorkspaceStores();
  const note = useStore(shown, (state) => state.byTab.get(tab) ?? null);
  if (note === null || note.path !== path) return <Reading />;
  return (
    <BacklinksPane
      links={note.links}
      mentions={note.mentions}
      onFindMentions={note.onFindMentions}
      onLinkMention={note.onLinkMention}
      onOpen={(target) => openNote(store, target)}
    />
  );
}

function NoteOutline({ shown, tab, path }: NotePanelProps) {
  const { reveals } = useWorkspaceStores();
  // The document alone: a keystroke publishes a new one and draws this, not the rows.
  const doc = useStore(shown, (state) => {
    const note = state.byTab.get(tab);
    return note !== undefined && note.path === path ? note.doc : null;
  });
  const headings = useMemo(() => (doc === null ? [] : outlineOf(doc)), [doc]);
  if (doc === null) return <Reading />;
  return (
    <OutlinePane
      headings={headings}
      onJump={(at) => {
        const heading = headings.find((each) => each.at === at);
        if (heading === undefined) return;
        requestReveal(reveals, { tab, path, fragment: { kind: 'heading', heading: heading.text } });
      }}
    />
  );
}

function NothingSelected() {
  return <p className="aside__empty">Nothing selected. Open a note, or select a row in a table.</p>;
}

/** Shown for the render between a tab reaching a note and the tab publishing it. */
function Reading() {
  return <p className="aside__empty">Reading…</p>;
}

/**
 * Escape in the aside that nothing inside answered: the focus goes back to
 * the pane being worked in, whose frame is what carries the focus
 * (`PaneFrame`). A query rather than a ref: the frame is drawn by the panes'
 * container, and the aside does not hold it.
 */
function focusTheWork(): void {
  document.querySelector<HTMLElement>('.pane--focused')?.focus();
}
