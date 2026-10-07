/**
 * Where the groups a person has folded shut are remembered, view by view.
 *
 * Which groups are shut is how this Mac looks at a view, not part of the view:
 * it is never written into the view note, so it neither syncs nor shows up as
 * an unsaved change. The app keeps it in `localStorage`; a test keeps it in a map.
 */
export interface GroupFoldStore {
  /** The ids of the groups folded shut in this view; none when nothing is remembered. */
  read(view: string): readonly string[];
  write(view: string, collapsed: readonly string[]): void;
}

/** Which groups — and swimlanes — of the view on screen are folded, and how to fold one. */
export interface GroupFolds {
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}
