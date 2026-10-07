// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import type { TagSuggestion } from '@atlas/domain';
import { createEditorExtensions, createReadingExtensions } from './extensions.ts';
import type { TagSuggestionView } from './tag-suggestion.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See #idea and #tag me# then ' },
        { type: 'text', text: '#code', marks: [{ type: 'code' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: '#linked', marks: [{ type: 'link', attrs: { href: 'x' } }] },
      ],
    },
    { type: 'codeBlock', content: [{ type: 'text', text: '#block color: #fff' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plans #draft' }] },
  ],
};

function editing({
  onOpenTag = null as ((name: string) => void) | null,
  suggestTags = (() => []) as (query: string) => readonly TagSuggestion[],
  onTagView = (() => {}) as (view: TagSuggestionView | null) => void,
  content = DOC,
} = {}) {
  editor = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => {},
      onSlashView: () => {},
      suggestTags,
      onTagView,
      onOpenTag,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
    }),
    content,
  });
  return editor;
}

const tagsIn = (instance: Editor) =>
  [...instance.view.dom.querySelectorAll('.tag')].map((element) => [
    element.textContent,
    element.getAttribute('data-tag'),
  ]);

/** Presses the pointer on `element`, as ProseMirror hands a click to its plugins. */
function clickOn(instance: Editor, element: Element): boolean {
  const event = new MouseEvent('mousedown', { bubbles: true });
  Object.defineProperty(event, 'target', { value: element });
  const position = instance.view.posAtDOM(element, 0);
  return (
    instance.view.someProp('handleClick', (handle) => handle(instance.view, position, event)) ??
    false
  );
}

describe('tags in the editor', () => {
  it('draws each tag in the text, but none in code, a link or a code block', () => {
    expect(tagsIn(editing())).toEqual([
      ['#idea', 'idea'],
      ['#tag me#', 'tag me'],
      ['#draft', 'draft'],
    ]);
  });

  it('keeps tags as text, so what is saved is what was typed', () => {
    const instance = editing();
    const paragraph = instance.getJSON().content?.[0]?.content ?? [];
    expect(paragraph[0]).toEqual({ type: 'text', text: 'See #idea and #tag me# then ' });
  });

  it('draws a tag as soon as it is typed, and stops when it is no longer one', () => {
    const instance = editing({ content: { type: 'doc', content: [{ type: 'paragraph' }] } });
    instance.commands.insertContent('a #new');
    expect(tagsIn(instance)).toEqual([['#new', 'new']]);
    instance.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a# new' }] }],
    });
    expect(tagsIn(instance)).toEqual([]);
  });

  it('opens a tag that is clicked, by its name as written', () => {
    const onOpenTag = vi.fn();
    const instance = editing({ onOpenTag });
    const tag = instance.view.dom.querySelector('[data-tag="tag me"]') as Element;
    expect(clickOn(instance, tag)).toBe(true);
    expect(onOpenTag).toHaveBeenCalledWith('tag me');
  });

  it('leaves a click elsewhere to the editor', () => {
    const onOpenTag = vi.fn();
    const instance = editing({ onOpenTag });
    const heading = instance.view.dom.querySelector('h2') as Element;
    expect(clickOn(instance, heading)).toBe(false);
    expect(onOpenTag).not.toHaveBeenCalled();
  });

  it('leaves a click on a tag to the editor where tags do not open', () => {
    const instance = editing();
    const tag = instance.view.dom.querySelector('[data-tag="idea"]') as Element;
    expect(clickOn(instance, tag)).toBe(false);
  });

  it('draws tags when a note is read too', () => {
    editor = new Editor({
      extensions: createReadingExtensions({ loadImage: async () => null }),
      content: DOC,
    });
    expect(tagsIn(editor)).toHaveLength(3);
  });
});

describe('suggesting tags after #', () => {
  const typeInto = (instance: Editor, text: string) => {
    for (const char of text) {
      const { from, to } = instance.state.selection;
      const handled = instance.view.someProp('handleTextInput', (handle) =>
        handle(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)),
      );
      if (handled !== true) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
    }
  };
  const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

  it('asks for tags with what follows the #, and offers what comes back', async () => {
    const suggestTags = vi.fn((query: string): readonly TagSuggestion[] => [
      { kind: 'create', name: query },
    ]);
    const views: (TagSuggestionView | null)[] = [];
    const instance = editing({
      suggestTags,
      onTagView: (view) => views.push(view),
      content: empty,
    });
    instance.commands.focus();
    typeInto(instance, 'x #ide');
    expect(suggestTags).toHaveBeenLastCalledWith('ide');
    // The plugin hands its items over once they resolve.
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([{ kind: 'create', name: 'ide' }]));
  });

  it('writes the picked tag and a space, as text', async () => {
    const views: (TagSuggestionView | null)[] = [];
    const instance = editing({
      suggestTags: () => [{ kind: 'existing', name: 'big idea', count: 2 }],
      onTagView: (view) => views.push(view),
      content: empty,
    });
    instance.commands.focus();
    typeInto(instance, '#bi');
    await vi.waitFor(() => expect(views.at(-1)?.items).toHaveLength(1));
    views.at(-1)?.insert({ kind: 'existing', name: 'big idea', count: 2 });
    expect(instance.getText()).toBe('#big idea# ');
  });

  it('is not offered after a letter, so C# is left alone', () => {
    const suggestTags = vi.fn((): readonly TagSuggestion[] => []);
    const instance = editing({ suggestTags, content: empty });
    instance.commands.focus();
    typeInto(instance, 'C#x');
    expect(suggestTags).not.toHaveBeenCalled();
  });

  it('is not offered in a code block', () => {
    const suggestTags = vi.fn((): readonly TagSuggestion[] => []);
    const instance = editing({
      suggestTags,
      content: { type: 'doc', content: [{ type: 'codeBlock' }] },
    });
    instance.commands.focus();
    typeInto(instance, ' #x');
    expect(suggestTags).not.toHaveBeenCalled();
  });
});
