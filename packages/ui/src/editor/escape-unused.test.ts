// @vitest-environment jsdom
/**
 * ProseMirror prevents the default of every Escape pressed in the editor,
 * used or not, so what holds the editor — the peek — cannot tell from
 * `defaultPrevented` alone whether the editor answered it. The editor says
 * so itself: an Escape none of its plugins took is marked as left alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { TagSuggestion } from '@dfai/domain';
import { createEditorExtensions } from './extensions.ts';
import { escapeLeftByEditor } from './escape-unused.ts';
import type { TagSuggestionView } from './tag-suggestion.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function typing(onTagView: (view: TagSuggestionView | null) => void = () => {}) {
  const tags: readonly TagSuggestion[] = [{ kind: 'existing', name: 'idea', count: 3 }];
  const instance = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => {},
      onSlashView: () => {},
      suggestTags: () => tags,
      onTagView,
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
    }),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    },
  });
  editor = instance;
  instance.commands.focus('end');
  return instance;
}

function pressEscape(instance: Editor): KeyboardEvent {
  // With its key code, which ProseMirror's own handling reads.
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    keyCode: 27,
    bubbles: true,
    cancelable: true,
  });
  instance.view.dom.dispatchEvent(event);
  return event;
}

describe('an Escape in the editor', () => {
  it('is marked as left alone when nothing in the editor answers it', () => {
    const event = pressEscape(typing());
    // Prevented all the same, by ProseMirror: the mark is what tells the two apart.
    expect(event.defaultPrevented).toBe(true);
    expect(escapeLeftByEditor(event)).toBe(true);
  });

  it('is not, when it closes a suggestion list', async () => {
    const views: (TagSuggestionView | null)[] = [];
    const instance = typing((view) => views.push(view));
    for (const char of ' #ide') {
      const { from, to } = instance.state.selection;
      instance.view.dispatch(instance.state.tr.insertText(char, from, to));
    }
    await vi.waitFor(() => expect(views.at(-1)?.items.length).toBe(1));
    const event = pressEscape(instance);
    expect(escapeLeftByEditor(event)).toBe(false);
  });

  it('is never said of another key, nor of an Escape pressed elsewhere', () => {
    const instance = typing();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    instance.view.dom.dispatchEvent(enter);
    expect(escapeLeftByEditor(enter)).toBe(false);
    expect(escapeLeftByEditor(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false);
  });
});
