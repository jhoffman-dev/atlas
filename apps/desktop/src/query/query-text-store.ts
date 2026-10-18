import { createStore, type StoreApi } from 'zustand';

/** The query being written on the query page, or null while no query page is shown. */
interface QueryTextState {
  readonly text: string | null;
}

/**
 * What the query page is writing, as the chat reads it for the window it
 * opens on (`chatWindowOf`). The page is a tab now (tab-model.md, PR B) and
 * owns its own hooks, so it says here what is typed; the app subscribes
 * only while the chat is open, as it does for the focused note.
 */
export type QueryTextStore = StoreApi<QueryTextState>;

export function createQueryTextStore(): QueryTextStore {
  return createStore<QueryTextState>()(() => ({ text: null }));
}

export function setQueryText(store: QueryTextStore, text: string | null): void {
  if (store.getState().text !== text) store.setState({ text });
}

/** The text as it stands, read at the moment it is needed rather than subscribed to. */
export function queryTextNow(store: QueryTextStore): string | null {
  return store.getState().text;
}
