import { useEffect, type ComponentProps } from 'react';
import { useStore } from 'zustand';
import { activeTabOf, createVaultPath } from '@atlas/domain';
import { clearRow, focusRow, hideAside, typeEditorShown, withinOf } from '../aside/aside-store.ts';
import { LoadedLater } from '../page-frame-fallback.tsx';
import { typePage } from '../pages-on-first-use.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useIndexKey } from '../index/index-status-store.ts';
import { useWorkspaceStores } from '../workspace/workspace-wiring.tsx';
import { typeTabsShown } from './type-tabs.ts';
import { useTypeTable } from './use-type-table.ts';

const TypePage = typePage.Component;

type TypePageProps = ComponentProps<typeof TypePage>;

/**
 * What a type's page needs from the window beyond what every page is
 * handed: showing the type's editor, which is the right sidebar's, and what
 * making and templating a note of the type go through, which are the
 * window's dialogs and commands.
 */
export interface TypeWiring {
  /** Shows the type's editor in the right sidebar, making room for it. */
  readonly onEditType: (name: string) => void;
  readonly onNewNote: TypePageProps['onNewNote'];
  readonly onEditTemplate: TypePageProps['onEditTemplate'];
}

/**
 * A type's page as a tab (tab-model.md, PR B): its table is read here, for
 * the type the place names, so a type page in either pane draws its own
 * table — not the one type the window used to assemble. One editor per
 * type: its queued changes and open question belong to that file.
 */
export function TypeContainer({
  wiring,
  tabId,
  chrome,
  name,
}: PageContainerProps & { name: string }) {
  const { pages, pane } = wiring;
  const { aside, store } = useWorkspaceStores();
  // The row this tab's table held goes with the tab.
  useEffect(() => () => clearRow(aside, tabId), [aside, tabId]);
  // Still read again on every news of the index: what it reads is not yet scoped (#325).
  const indexKey = useIndexKey(pane.indexStatus, pane.vault);
  const { onEditType, onNewNote, onEditTemplate } = pages.type;
  // Pressed while the aside shows the Type tab for this tab: the editor
  // follows the focused tab, so a type page in the other pane is not pressed.
  const typeTabShown = useStore(aside, typeEditorShown);
  const focused = useStore(store, (state) => activeTabOf(state.workspace).id === tabId);
  const editing = typeTabShown && focused;
  const table = useTypeTable({
    fs: pages.ports.fs,
    markdown: pane.notes.markdown,
    index: pane.index,
    types: pane.types,
    typeName: name,
    indexKey,
    onChanged: pane.onChanged,
    editors: pane.editors,
    activity: pane.activity,
  });
  return (
    <LoadedLater chrome={chrome}>
      <TypePage
        key={name}
        table={table}
        types={pane.types}
        editing={editing}
        onEditType={() => (editing ? hideAside(aside) : onEditType(name))}
        ports={{
          fs: pages.ports.fs,
          markdown: pane.notes.markdown,
          index: pane.index,
          openNotes: pane.editors,
        }}
        onSaved={pane.onTypeSaved}
        onOpenNote={pages.openNote}
        onNewNote={onNewNote}
        tabs={
          table.type === null
            ? []
            : typeTabsShown(
                { savedViews: pane.savedViews, takenViewPaths: pane.viewPaths },
                table.type,
              )
        }
        tabEditing={pane.typeTabs({ typeName: name, onOpenView: pages.openNote })}
        onOpenView={pages.openNote}
        onEditTemplate={onEditTemplate}
        // The row the table's focus is in, for the aside: held against this type's page.
        onRowFocus={(path) =>
          focusRow(aside, {
            tab: tabId,
            path: createVaultPath(path),
            within: withinOf({ kind: 'type', name }),
          })
        }
        {...chrome}
      />
    </LoadedLater>
  );
}
