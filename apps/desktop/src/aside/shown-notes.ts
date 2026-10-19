import { useEffect } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { EditorDocument, TabId, VaultPath } from '@atlas/domain';
import type { BacklinksPane, PropertiesPanel } from '@atlas/ui';

type PanelProps = Parameters<typeof PropertiesPanel>[0];
type BacklinksProps = Parameters<typeof BacklinksPane>[0];

/**
 * What a note tab shows, as the aside needs it: the properties as the page's
 * own panel draws them (so the aside's rows write through the same
 * `onChange`, with the same commit rules), the links, and the document for
 * the outline.
 */
export interface ShownNote {
  readonly path: VaultPath;
  readonly title: string;
  /** What the aside's kicker says the note is: its type's label, or "Note". */
  readonly kicker: string;
  readonly panel: Omit<PanelProps, 'folded'>;
  readonly links: BacklinksProps['links'];
  readonly mentions: BacklinksProps['mentions'];
  readonly onFindMentions: BacklinksProps['onFindMentions'];
  readonly onLinkMention: BacklinksProps['onLinkMention'];
  readonly doc: EditorDocument;
}

interface ShownNotesState {
  readonly byTab: ReadonlyMap<TabId, ShownNote>;
}

/**
 * Each note tab's say of what it shows, keyed by tab, so the aside reads the
 * tab it follows through a selector rather than through props from `App`
 * (#306). A tab publishes as its note loads and as its properties change, and
 * withdraws as it unmounts; nothing subscribes while the aside is shut, so a
 * publish then costs no draw.
 */
export type ShownNotes = StoreApi<ShownNotesState>;

export function createShownNotes(): ShownNotes {
  return createStore<ShownNotesState>()(() => ({ byTab: new Map() }));
}

export function publishShownNote(store: ShownNotes, tab: TabId, shown: ShownNote | null): void {
  const { byTab } = store.getState();
  if (byTab.get(tab) === (shown ?? undefined)) return;
  const next = new Map(byTab);
  if (shown === null) next.delete(tab);
  else next.set(tab, shown);
  store.setState({ byTab: next });
}

export function useShownNote(store: ShownNotes, tab: TabId): ShownNote | null {
  return useStore(store, (state) => state.byTab.get(tab) ?? null);
}

/**
 * Publishes a tab's note after each render that changed it, and withdraws it
 * as the tab unmounts. The caller memoises `shown` on what the aside reads,
 * so a keystroke that changes only the document publishes the document and
 * nothing else draws for it.
 */
export function usePublishShownNote(store: ShownNotes, tab: TabId, shown: ShownNote | null): void {
  useEffect(() => {
    publishShownNote(store, tab, shown);
  }, [store, tab, shown]);
  useEffect(() => () => publishShownNote(store, tab, null), [store, tab]);
}
