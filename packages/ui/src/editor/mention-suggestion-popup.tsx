import { personInitial, placeCrumb, type MentionSuggestion } from '@atlas/domain';
import { SuggestionPopup, type PopupItem } from './suggestion-popup.tsx';
import type { MentionSuggestionView } from './mention-suggestion.ts';

const idOf = (item: MentionSuggestion) =>
  item.kind === 'create' ? `create:${item.name}` : `person:${item.path}`;

function popupItem(item: MentionSuggestion): PopupItem {
  switch (item.kind) {
    case 'person':
      return {
        id: idOf(item),
        label: item.name,
        hint: placeCrumb(item.path).parent,
        avatar: personInitial(item.name),
      };
    case 'unlinkable':
      return {
        id: idOf(item),
        label: item.name,
        hint: item.reason,
        avatar: personInitial(item.name),
        disabled: true,
      };
    case 'create':
      return { id: idOf(item), label: `Create person “${item.name}”`, hint: 'New person' };
  }
}

/**
 * The `@` popup: people with their initial and where they live, someone no
 * link could open with why, or "Create person" for a new name.
 */
export function MentionSuggestionPopup({ view }: { view: MentionSuggestionView }) {
  return (
    <SuggestionPopup
      label="Mention a person"
      items={view.items.map(popupItem)}
      selected={view.selected}
      rect={view.rect}
      onPick={(id) => {
        const item = view.items.find((candidate) => idOf(candidate) === id);
        if (item !== undefined) view.insert(item);
      }}
    />
  );
}
