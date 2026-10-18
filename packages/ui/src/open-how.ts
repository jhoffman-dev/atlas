/**
 * Where a click asks a place to open (docs/design/tab-model.md, James's
 * decision on #303): a plain click here, in the tab being read; ⌘-click in a
 * new tab beside it; ⌘⇧-click in the other pane, splitting for one. Ctrl
 * stands in for ⌘ off a Mac, as it does for the graph.
 */
export type OpenHow = 'here' | 'new-tab' | 'split';

export function openHowFrom(event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}): OpenHow {
  if (!(event.metaKey || event.ctrlKey)) return 'here';
  return event.shiftKey ? 'split' : 'new-tab';
}
