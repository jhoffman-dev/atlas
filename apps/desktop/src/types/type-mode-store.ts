import { createStore, type StoreApi } from 'zustand';
import type { TabId } from '@atlas/domain';

/** The one type page the window asked to open on its editor, by the tab it was opened into. */
interface TypeModeState {
  readonly editAsked: { readonly tabId: TabId; readonly name: string } | null;
}

/**
 * A type's page opens on its notes unless asked for its editor — from the
 * sidebar's "Edit type", a new type, the palette. The ask names the tab it
 * was opened into (tab-model.md, PR B): the mode is that tab's, so editing
 * Person in one pane leaves Book's table in the other, and a tab's own
 * Back and Forward keep what it chose.
 */
export type TypeModeStore = StoreApi<TypeModeState>;

export function createTypeModeStore(): TypeModeStore {
  return createStore<TypeModeState>()(() => ({ editAsked: null }));
}

export function askToEdit(store: TypeModeStore, asked: { tabId: TabId; name: string }): void {
  store.setState({ editAsked: asked });
}

/** Whether the editor was asked for `name` in `tabId`; taking it answers the ask, once. */
export function takeEditAsked(store: TypeModeStore, at: { tabId: TabId; name: string }): boolean {
  const { editAsked } = store.getState();
  if (editAsked === null || editAsked.tabId !== at.tabId || editAsked.name !== at.name)
    return false;
  store.setState({ editAsked: null });
  return true;
}
