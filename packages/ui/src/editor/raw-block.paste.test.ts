// @vitest-environment jsdom
/**
 * Issue #541. A raw block — a table, a callout
 * DFAI does not model, raw HTML — is put on the clipboard as
 * `<pre data-raw-block>` with its source as the text, but the parse rule
 * (raw-block.ts `parseHTML`) is outranked by the code block's `pre` rule, and
 * reads no `markdown` back even where it wins: pasted, the table comes back as
 * a code block of its source, saved as a fenced block where the table was.
 * Its text/plain is empty: a raw block has no leaf text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { createEditorExtensions } from './extensions.ts';

const TABLE = '| Seed | Days |\n| --- | --- |\n| Kale | 55 |';
const HTML_BLOCK = '<details>\n<summary>Fern notes</summary>\nSpores in autumn.\n</details>';

const editors: Editor[] = [];
afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
});

function noteWith(blocks: readonly string[]): Editor {
  const instance = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => {},
      onSlashView: () => {},
      suggestTags: () => [],
      onTagView: () => {},
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
    }),
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Above.' }] },
        ...blocks.map((markdown) => ({ type: 'rawBlock', attrs: { markdown } })),
        { type: 'paragraph', content: [{ type: 'text', text: 'Below.' }] },
      ],
    },
  });
  editors.push(instance);
  return instance;
}

function clipboardEvent(type: 'copy' | 'cut' | 'paste', held = new Map<string, string>()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => held.clear(),
      setData: (kind: string, value: string) => void held.set(kind, value),
      getData: (kind: string) => held.get(kind) ?? '',
      types: [...held.keys()],
      files: [],
      items: [],
    },
  });
  return { held, event };
}

function copyAll(instance: Editor, type: 'copy' | 'cut'): Map<string, string> {
  instance.view.dispatch(instance.state.tr.setSelection(new AllSelection(instance.state.doc)));
  const { held, event } = clipboardEvent(type);
  instance.view.dom.dispatchEvent(event);
  return held;
}

function pasteAtEnd(instance: Editor, held: Map<string, string>): void {
  const end = instance.state.doc.content.size - 1;
  instance.view.dispatch(
    instance.state.tr.setSelection(TextSelection.create(instance.state.doc, end)),
  );
  instance.view.dom.dispatchEvent(clipboardEvent('paste', new Map(held)).event);
}

/** Each raw block's source, in order: each is written to the file as it is. */
const rawSources = (instance: Editor): string[] => {
  const found: string[] = [];
  instance.state.doc.descendants((node) => {
    if (node.type.name === 'rawBlock') found.push(String(node.attrs['markdown']));
  });
  return found;
};

describe('a raw block copied and pasted in the editor', () => {
  it('keeps the table bytes when pasted back into the same note', () => {
    const instance = noteWith([TABLE]);
    const held = copyAll(instance, 'copy');
    pasteAtEnd(instance, held);
    expect(rawSources(instance)).toEqual([TABLE, TABLE]);
  });

  it('keeps the table bytes when cut and pasted back', () => {
    const instance = noteWith([TABLE]);
    const held = copyAll(instance, 'cut');
    pasteAtEnd(instance, held);
    expect(rawSources(instance)).toEqual([TABLE]);
  });

  it('keeps the table bytes when pasted into another note', () => {
    const source = noteWith([TABLE]);
    const target = noteWith([]);
    pasteAtEnd(target, copyAll(source, 'copy'));
    expect(rawSources(target)).toEqual([TABLE]);
  });

  it('keeps a raw HTML block when pasted into another note', () => {
    const source = noteWith([HTML_BLOCK]);
    const target = noteWith([]);
    pasteAtEnd(target, copyAll(source, 'copy'));
    expect(rawSources(target)).toEqual([HTML_BLOCK]);
  });

  it('is not turned into a code block when pasted', () => {
    const source = noteWith([TABLE]);
    const target = noteWith([]);
    pasteAtEnd(target, copyAll(source, 'copy'));
    const types: string[] = [];
    target.state.doc.forEach((node) => types.push(node.type.name));
    expect(types).not.toContain('codeBlock');
  });

  it('puts its source in text/plain, for a paste into another app', () => {
    const held = copyAll(noteWith([TABLE]), 'copy');
    expect(held.get('text/plain')).toContain('| Kale | 55 |');
  });
});
