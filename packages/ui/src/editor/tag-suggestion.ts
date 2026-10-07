import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { formatTag, type TagSuggestion } from '@atlas/domain';
import { pickerSuggestion, type PickerView } from './picker-suggestion.ts';

export type TagSuggestionView = PickerView<TagSuggestion>;

export interface TagSuggestionOptions {
  /** Tags for what has been typed after `#`: none until it is a letter. */
  suggest: (query: string) => readonly TagSuggestion[];
  onView: (view: TagSuggestionView | null) => void;
}

/**
 * Offers tags after `#`: the vault's own, most used first, or a new one.
 *
 * Only after a space, a bracket or the start of a line, so `C#` and a URL's
 * fragment are left alone, and never in code. A space ends it — `# ` is a
 * heading, and a new single-word tag is simply typed on past.
 */
export const TagSuggestionExtension = Extension.create<TagSuggestionOptions>({
  name: 'tagSuggestion',

  addOptions() {
    return { suggest: () => [], onView: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      pickerSuggestion<TagSuggestion>({
        editor: this.editor,
        pluginKey: new PluginKey('tagSuggestion'),
        char: '#',
        startOfLine: false,
        allowSpaces: false,
        allowedPrefixes: [' ', '('],
        allow: ({ state, range }) => {
          const at = state.doc.resolve(range.from);
          return (
            at.parent.type.name !== 'codeBlock' &&
            !at.marks().some((mark) => mark.type.name === 'code')
          );
        },
        find: (query) => [...options.suggest(query)],
        onView: (view) => options.onView(view),
        // Written as text, which is what a tag is; the space after it closes the
        // word, so typing carries on outside the tag.
        command: ({ editor, range, props: suggestion }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, { type: 'text', text: `${formatTag(suggestion.name)} ` })
            .run();
        },
      }),
    ];
  },
});
