// @vitest-environment jsdom
/**
 * The caret popup's keys (`[[`, `/` and `#` share them): the arrows move the
 * selection round the list, Enter and Tab pick, Escape closes, and anything
 * else is left to the editor. Driven through the `#` suggestion, as typed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { TagSuggestion } from '@atlas/domain';
import { createEditorExtensions } from './extensions.ts';
import type { TagSuggestionView } from './tag-suggestion.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const ITEMS: readonly TagSuggestion[] = [
  { kind: 'create', name: 'ide' },
  { kind: 'existing', name: 'idea', count: 3 },
  { kind: 'existing', name: 'ideas', count: 9 },
];

async function typedTag(items: readonly TagSuggestion[] = ITEMS) {
  const views: (TagSuggestionView | null)[] = [];
  const instance = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => {},
      onSlashView: () => {},
      suggestTags: () => items,
      onTagView: (view) => views.push(view),
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
    }),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor = instance;
  instance.commands.focus();
  for (const char of 'x #ide') {
    const { from, to } = instance.state.selection;
    instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
  if (items.length > 0) await vi.waitFor(() => expect(views.at(-1)?.items).toEqual(items));
  // The popup's own handler: whether it takes the key, before the editor's keymaps.
  const popup = instance.state.plugins.find((plugin) =>
    (plugin as unknown as { key: string }).key.startsWith('tagSuggestion'),
  );
  const press = (key: string) =>
    popup?.props.handleKeyDown?.call(popup, instance.view, new KeyboardEvent('keydown', { key })) ??
    false;
  return { instance, views, press, selected: () => views.at(-1)?.selected };
}

describe('the keys of a caret popup', () => {
  it('starts on the first item', async () => {
    const { selected } = await typedTag();
    expect(selected()).toBe(0);
  });

  it('moves down with ArrowDown, and from the last item round to the first', async () => {
    const { press, selected } = await typedTag();
    expect(press('ArrowDown')).toBe(true);
    expect(selected()).toBe(1);
    press('ArrowDown');
    expect(selected()).toBe(2);
    press('ArrowDown');
    expect(selected()).toBe(0);
  });

  it('moves up with ArrowUp, and from the first item round to the last', async () => {
    const { press, selected } = await typedTag();
    expect(press('ArrowUp')).toBe(true);
    expect(selected()).toBe(2);
    press('ArrowUp');
    expect(selected()).toBe(1);
  });

  it('writes the first item on Enter, which is what was typed', async () => {
    const { instance, press } = await typedTag();
    expect(press('Enter')).toBe(true);
    expect(instance.getText()).toBe('x #ide ');
  });

  it('writes the selected item on Enter', async () => {
    const { instance, press } = await typedTag();
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    expect(instance.getText()).toBe('x #ideas ');
  });

  it('writes the selected item on Tab too', async () => {
    const { instance, press } = await typedTag();
    press('ArrowDown');
    expect(press('Tab')).toBe(true);
    expect(instance.getText()).toBe('x #idea ');
  });

  it('closes on Escape without writing anything', async () => {
    const { instance, press, views } = await typedTag();
    expect(press('Escape')).toBe(true);
    expect(views.at(-1)).toBeNull();
    expect(instance.getText()).toBe('x #ide');
  });

  it('leaves other keys to the editor', async () => {
    const { press, selected } = await typedTag();
    expect(press('a')).toBe(false);
    expect(press('ArrowLeft')).toBe(false);
    expect(selected()).toBe(0);
  });

  it('leaves every key to the editor when there is nothing to pick', async () => {
    const { instance, press } = await typedTag([]);
    expect(press('ArrowDown')).toBe(false);
    expect(press('ArrowUp')).toBe(false);
    expect(instance.getText()).toBe('x #ide');
  });
});
