import { useEffect, useState, type ComponentProps } from 'react';
import { LoadedLater } from '../page-frame-fallback.tsx';
import { typePage } from '../pages-on-first-use.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
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
  /** Notes asked for from the editor: it may land on one of the type's views instead. */
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
  const { editAsked, onNotes, onNewNote, onDelete, onEditTemplate } = pages.type;
  // This tab's mode: the editor when the window asked for it here, else the notes.
  const [mode, setMode] = useState<TypePageMode>(() =>
    takeEditAsked(editAsked, { tabId, name }) ? 'edit' : 'notes',
  );
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
    indexKey: pane.indexKey,
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
        onModeChange={(next) => (next === 'notes' ? onNotes(name) : setMode(next))}
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
        {...chrome}
      />
    </LoadedLater>
  );
}
