/**
 * Where a saved query view's fold — its query shown as one line, or open in
 * the builder — is remembered, view by view.
 *
 * Like a group fold, it is how this Mac looks at the view, not part of the
 * view: never written into the view note, so it neither syncs nor counts as
 * an unsaved change. The app keeps it in `localStorage`; a test keeps it in a map.
 */
export interface QueryPanelFoldStore {
  /** Whether the query was left folded; null when the view has not been left either way. */
  read(view: string): boolean | null;
  write(view: string, collapsed: boolean): void;
}

/** Whether the query on screen is folded to one line, and how to fold or open it. */
export interface QueryPanelFold {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}
