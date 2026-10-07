import { formatTag, type TagSuggestion } from '@atlas/domain';
import { SuggestionPopup } from './suggestion-popup.tsx';
import type { TagSuggestionView } from './tag-suggestion.ts';

const idOf = (item: TagSuggestion) => `${item.kind}:${item.name}`;

/** The `#` popup: the vault's tags with their counts, or "Create" for a new one. */
export function TagSuggestionPopup({ view }: { view: TagSuggestionView }) {
  return (
    <SuggestionPopup
      label="Tag"
      items={view.items.map((item) => ({
        id: idOf(item),
        label: item.kind === 'create' ? `Create ${formatTag(item.name)}` : formatTag(item.name),
        hint: item.kind === 'create' ? 'New tag' : String(item.count),
      }))}
      selected={view.selected}
      rect={view.rect}
      onPick={(id) => {
        const item = view.items.find((candidate) => idOf(candidate) === id);
        if (item !== undefined) view.insert(item);
      }}
    />
  );
}
