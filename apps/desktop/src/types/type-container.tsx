import { useEffect, useState, type ComponentProps } from 'react';
import { createVaultPath } from '@atlas/domain';
import { clearRow, focusRow, withinOf } from '../aside/aside-store.ts';
import { LoadedLater } from '../page-frame-fallback.tsx';
import { typePage } from '../pages-on-first-use.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useIndexKey } from '../index/index-status-store.ts';
import { useWorkspaceStores } from '../workspace/workspace-wiring.tsx';
import { takeEditAsked, type TypeModeStore } from './type-mode-store.ts';
import type { TypePageMode } from './type-page.tsx';
import { typeTabsShown } from './type-tabs.ts';
import { useTypeTable } from './use-type-table.ts';

const TypePage = typePage.Component;

type TypePageProps = ComponentProps<typeof TypePage>;

/**
 * What a type's page needs from the window beyond what every page is
 * handed: which of its modes the window asked for (a type opened to be
 * edited), and what making, deleting and templating a note of the type
 * go through, which are the window's dialogs and commands.
 */
export interface TypeWiring {
  /** Where the window says which tab it asked to open on a type's editor. */
  readonly editAsked: TypeModeStore;
  /** Notes asked for from the editor: the type's page lands on one of its views when it has one. */
  readonly onNotes: (name: string) => void;
  readonly onNewNote: TypePageProps['onNewNote'];
  readonly onDelete: TypePageProps['onDelete'];
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
  const { aside } = useWorkspaceStores();
  // The row this tab's table held goes with the tab.
  useEffect(() => () => clearRow(aside, tabId), [aside, tabId]);
  // Still read again on every news of the index: what it reads is not yet scoped (#325).
  const indexKey = useIndexKey(pane.indexStatus, pane.vault);
  const { editAsked, onNotes, onNewNote, onDelete, onEditTemplate } = pages.type;
  // This tab's mode: the editor when the window asked for it here, else the notes.
  const modeAsked = (): TypePageMode =>
    takeEditAsked(editAsked, { tabId, name }) ? 'edit' : 'notes';
  const [mode, setMode] = useState<TypePageMode>(modeAsked);
  // Another type opened in this tab starts on its notes, unless its editor was
  // asked for: the ask lands before the tab is drawn with the new name, so it
  // is taken as the name changes, not by the subscription made for the last one.
  const [shown, setShown] = useState(name);
  if (shown !== name) {
    setShown(name);
    setMode(modeAsked());
  }
  // Asked again while shown — the sidebar's Edit type on the type already open here.
  useEffect(
    () =>
      editAsked.subscribe(() => {
        if (takeEditAsked(editAsked, { tabId, name })) setMode('edit');
      }),
    [editAsked, tabId, name],
  );
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
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          // Notes may be one of the type's views, which the window opens in this tab's place.
          if (next === 'notes') onNotes(name);
        }}
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
        onDelete={onDelete}
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
