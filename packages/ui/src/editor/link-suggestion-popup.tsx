import { placeCrumb, type OutlineEntry } from '@atlas/domain';
import { SuggestionPopup, type PopupItem } from './suggestion-popup.tsx';
import type { LinkChoice } from './block-picking.ts';
import type { WikiSuggestionView } from './wiki-link-suggestion.ts';

/** What the `[[` list answers to: Enter for a link, Shift+Enter for a bookmark. */
const LINK_PICKER_HINTS = [
  ['↵', 'Link'],
  ['⇧ ↵', 'Bookmark'],
] as const;

/** What the list answers to once it offers a note's blocks. */
const BLOCK_PICKER_HINTS = [['↵', 'Link'] as const] as const;
const EMBED_PICKER_HINTS = [['↵', 'Embed'] as const] as const;

/**
 * The `[[` and `![[` list (P26-02): notes, each with where it lives; then,
 * after a `#`, the note's headings and blocks, each block with a line or two
 * of what it says, as Capacities previews them.
 */
export function LinkSuggestionPopup({ view }: { view: WikiSuggestionView }) {
  const blocks = view.items.some((item) => item.kind === 'fragment');
  const hints = blocks
    ? view.embed
      ? EMBED_PICKER_HINTS
      : BLOCK_PICKER_HINTS
    : view.insertAlternate !== undefined
      ? LINK_PICKER_HINTS
      : undefined;
  return (
    <SuggestionPopup
      label={blocks ? 'Link to block' : 'Link to note'}
      variant={blocks ? 'blocks' : 'notes'}
      items={view.items.map(popupItemOf)}
      selected={view.selected}
      rect={view.rect}
      onPick={(id, other) => {
        const item = view.items.find((candidate) => idOf(candidate) === id);
        if (item === undefined) return;
        if (other && view.insertAlternate !== undefined) view.insertAlternate(item);
        else view.insert(item);
      }}
      {...(hints !== undefined && { hints })}
    />
  );
}

function idOf(item: LinkChoice): string {
  return item.kind === 'note' ? item.note.path : `${item.entry.kind}:${item.entry.at.join('.')}`;
}

function popupItemOf(item: LinkChoice): PopupItem {
  if (item.kind === 'note') {
    return { id: idOf(item), label: item.note.target, hint: placeCrumb(item.note.path).parent };
  }
  return { id: idOf(item), label: item.entry.text, hint: kindOf(item.entry) };
}

/** What a heading or block is, as its line in the list names it. */
function kindOf(entry: OutlineEntry): string {
  if (entry.kind === 'heading') return `Heading ${entry.level}`;
  return BLOCK_KINDS[entry.type] ?? 'Block';
}

const BLOCK_KINDS: Readonly<Record<string, string>> = {
  paragraph: 'Text',
  listItem: 'List item',
  taskItem: 'Task',
  blockquote: 'Quote',
  callout: 'Callout',
  codeBlock: 'Code',
  table: 'Table',
};
