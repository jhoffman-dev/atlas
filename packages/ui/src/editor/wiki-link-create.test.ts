// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createVaultPath, type NoteSuggestion } from '@atlas/domain';
import { createEditorExtensions } from './extensions.ts';
import type { WikiSuggestionView } from './wiki-link-suggestion.ts';
import { withCreate } from './wiki-link-suggestion.ts';

/** #465: `[[` in the editor offers "Create '<typed>'" when no note is called that. */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const GARDEN: NoteSuggestion = { path: createVaultPath('Areas/Garden.md'), target: 'Garden' };

function editing({
  suggest = () => [],
  createNote = null,
  views = [],
}: {
  suggest?: (query: string) => NoteSuggestion[];
  createNote?: ((name: string) => Promise<void>) | null;
  views?: (WikiSuggestionView | null)[];
}) {
  editor = new Editor({
    extensions: createEditorExtensions({
      suggest,
      onView: (view) => views.push(view),
      onSlashView: () => {},
      suggestTags: () => [],
      onTagView: () => {},
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
      createNote,
    }),
    content: empty,
  });
  editor.commands.focus('end');
  return editor;
}

/** Types as a person does, so the suggestion plugin sees each keystroke. */
function typeInto(instance: Editor, text: string) {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const handled = instance.view.someProp('handleTextInput', (handle) =>
      handle(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)),
    );
    if (handled !== true) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
}

describe('withCreate', () => {
  it('offers to make a note when none offered is called what was typed', () => {
    expect(withCreate([GARDEN], 'Gard').map((choice) => choice.kind)).toEqual(['note', 'create']);
    expect(withCreate([], ' Mara Quill ').at(-1)).toEqual({ kind: 'create', name: 'Mara Quill' });
  });

  it('offers none when a note is already called that, whatever its case or accents', () => {
    expect(withCreate([GARDEN], 'garden').map((choice) => choice.kind)).toEqual(['note']);
  });

  it('offers none for nothing typed', () => {
    expect(withCreate([], '  ')).toEqual([]);
  });
});

describe('[[ Create in the editor', () => {
  it('writes the link to the new name at once, and makes the note behind it', async () => {
    const createNote = vi.fn(async () => {});
    const views: (WikiSuggestionView | null)[] = [];
    const instance = editing({ createNote, views });
    typeInto(instance, 'See [[Tobias Fenn');
    await vi.waitFor(() =>
      expect(views.at(-1)?.items.at(-1)).toEqual({ kind: 'create', name: 'Tobias Fenn' }),
    );
    const view = views.at(-1);
    const create = view?.items.at(-1);
    if (view === null || view === undefined || create === undefined) throw new Error('no list');
    view.insert(create);
    expect(createNote).toHaveBeenCalledWith('Tobias Fenn');
    expect(instance.getJSON().content?.[0]?.content).toEqual([
      { type: 'text', text: 'See ' },
      {
        type: 'wikiLink',
        attrs: { target: 'Tobias Fenn', heading: null, alias: null, embed: false },
      },
      { type: 'text', text: ' ' },
    ]);
  });

  it('offers no Create where notes cannot be made, nor after ![[', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const instance = editing({ views });
    typeInto(instance, '[[Tobias');
    await vi.waitFor(() => expect(views.length).toBeGreaterThan(0));
    expect(views.some((view) => view?.items.some((item) => item.kind === 'create'))).toBe(false);
    editor?.destroy();
    const embedViews: (WikiSuggestionView | null)[] = [];
    const embedding = editing({ createNote: async () => {}, views: embedViews });
    typeInto(embedding, '![[Tobias');
    await vi.waitFor(() => expect(embedViews.length).toBeGreaterThan(0));
    expect(
      embedViews.some((view) => view?.embed && view.items.some((item) => item.kind === 'create')),
    ).toBe(false);
  });
});
