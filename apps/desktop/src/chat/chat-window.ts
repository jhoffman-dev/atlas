import type { ChatWindow } from '@atlas/application';
import type { VaultPath } from '@atlas/domain';

/**
 * What the chat is opened on: the query being written, the note, view or
 * dashboard in the focused pane — or nothing, on a page that is neither, such
 * as the graph, where the pane behind it is not what is being looked at.
 */
export function chatWindowOf({
  query,
  otherPage,
  focused,
}: {
  /** The query page's text while it is open, else null. */
  query: string | null;
  /** A whole-window page other than the query is open: a type, the graph, tags, the archive. */
  otherPage: boolean;
  focused: VaultPath | null;
}): ChatWindow {
  if (query !== null) return { kind: 'query', text: query };
  if (otherPage || focused === null) return { kind: 'none' };
  return { kind: 'path', path: focused };
}
