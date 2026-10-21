// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { splitWikiLinks, type NoteSuggestion } from '@atlas/domain';
import { createEditorExtensions } from './extensions.ts';
import { withCreate, type WikiSuggestionView } from './wiki-link-suggestion.ts';

/**
 * Verify pass on PR #469 (#465): `[[` Create refuses `/ | #` but not the
 * other characters a link reads as its own syntax (`[`, `]`, `^`; see
 * LINK_SYNTAX in domain/markdown/wikilink.ts). `[[Foo [x` makes `Foo [x.md`
 * and writes `[[Foo [x]]`, which reads back as plain text: the link is lost
 * on the next load. Person and related-note creation refuse these names.
 */

const NONE_TAKEN = () => false;

describe('withCreate (verify #469)', () => {
  it('the link a Create would write for `Foo [x` does not read back as a link', () => {
    // Shows why the next test matters: the bracket ends the link on reload.
    expect(splitWikiLinks('[[Foo [x]]').some((piece) => piece.kind === 'wikiLink')).toBe(false);
  });

  it('offers no Create for a name holding a character a link cannot hold: [ ] ^', () => {
    for (const typed of ['Foo [x', 'Foo ]x', 'Plan ^v2']) {
      expect(withCreate([], typed, NONE_TAKEN), typed).toEqual([]);
    }
  });
});

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

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

describe('[[ Create in the editor (verify #469)', () => {
  it('offers no Create after `[[Foo [x`, whose link would read back as text', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const suggest = vi.fn((): NoteSuggestion[] => []);
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
        createNote: { named: NONE_TAKEN, make: async (name) => name },
      }),
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    editor.commands.focus('end');
    typeInto(editor, 'See [[Foo [x');
    await vi.waitFor(() => expect(suggest).toHaveBeenLastCalledWith('Foo [x'));
    await new Promise((settle) => setTimeout(settle, 0));
    expect(views.at(-1)?.items ?? []).toEqual([]);
  });
});
