// @vitest-environment jsdom
/**
 * Drawing tags as the note is typed in (A20-03): what is drawn after any edit
 * is what reading the whole note afresh would draw, and an edit rereads only
 * the blocks it touched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { createEditorExtensions } from './extensions.ts';

const editors: Editor[] = [];
afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
});

function editing(content: JSONContent) {
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
    content,
  });
  editors.push(instance);
  return instance;
}

const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks !== undefined && { marks }),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const tagsIn = (instance: Editor) =>
  [...instance.view.dom.querySelectorAll('.tag')].map((element) => [
    element.textContent,
    element.getAttribute('data-tag'),
  ]);

/** The highlighter's decorations, as its plugin holds them. */
function decorations(state: EditorState): DecorationSet {
  const plugin = state.plugins.find((candidate) =>
    (candidate as unknown as { key: string }).key.startsWith('tagHighlight'),
  );
  return plugin?.getState(state) as DecorationSet;
}

/** What a decoration was made as, which a copy of it shares. */
const typeOf = (decoration: unknown) => (decoration as { type: unknown }).type;

describe('drawing tags while typing', () => {
  it('rereads only the block that changed, keeping the others’ tags as they were', () => {
    const instance = editing(doc(paragraph(text('#one here')), paragraph(text('plain'))));
    const firstBlockEnd = instance.state.doc.child(0).nodeSize;
    const before = decorations(instance.state).find(0, firstBlockEnd);
    expect(before).toHaveLength(1);

    instance.commands.insertContentAt(instance.state.doc.content.size - 1, ' #two');

    expect(tagsIn(instance)).toEqual([
      ['#one', 'one'],
      ['#two', 'two'],
    ]);
    const after = decorations(instance.state).find(0, firstBlockEnd);
    expect(after).toHaveLength(1);
    // `find` hands back copies; the type behind one is only new when it is read again.
    expect(typeOf(after[0])).toBe(typeOf(before[0]));
  });

  it('moves a tag along when text is typed before it', () => {
    const instance = editing(doc(paragraph(text('x #one'))));
    instance.commands.insertContentAt(1, 'abc ');
    expect(tagsIn(instance)).toEqual([['#one', 'one']]);
    expect(instance.getText()).toBe('abc x #one');
  });

  it('reads a tag made by joining two blocks', () => {
    const instance = editing(doc(paragraph(text('#ab')), paragraph(text('c'))));
    const end = instance.state.doc.child(0).nodeSize;
    instance.view.dispatch(instance.state.tr.delete(end - 1, end + 1));
    expect(tagsIn(instance)).toEqual([['#abc', 'abc']]);
  });

  it('stops drawing a tag whose # is deleted', () => {
    const instance = editing(doc(paragraph(text('a #one')), paragraph(text('#two'))));
    instance.view.dispatch(instance.state.tr.delete(3, 4));
    expect(tagsIn(instance)).toEqual([['#two', 'two']]);
  });

  it('reads a block again when a mark changes in it, since marks split its text runs', () => {
    const instance = editing(doc(paragraph(text('x#tag'))));
    expect(tagsIn(instance)).toEqual([]);
    instance.chain().setTextSelection({ from: 1, to: 2 }).setBold().run();
    expect(tagsIn(instance)).toEqual([['#tag', 'tag']]);
    instance.chain().setTextSelection({ from: 1, to: 2 }).unsetBold().run();
    expect(tagsIn(instance)).toEqual([]);
  });

  it('draws what a fresh reading draws, after any run of edits', () => {
    // Seeded, so a failure is the same failure on every run.
    let seed = 20260927;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pieces = ['#', '#', ' ', 'a', 'b', '/', '_', 'C', '#tag me#', '\n', 'bold'];
    const instance = editing(doc(paragraph(text('#start of it')), paragraph(text('and #more'))));
    for (let step = 0; step < 300; step += 1) {
      const size = instance.state.doc.content.size;
      const from = 1 + Math.floor(random() * (size - 1));
      const piece = pieces[Math.floor(random() * pieces.length)] as string;
      if (piece === '\n') instance.chain().setTextSelection(from).splitBlock().run();
      else if (piece === 'bold') {
        instance
          .chain()
          .setTextSelection({ from, to: from + 1 })
          .toggleBold()
          .run();
      } else if (random() < 0.3 && from + 1 < size) {
        instance.view.dispatch(instance.state.tr.delete(from, from + 1));
      } else instance.view.dispatch(instance.state.tr.insertText(piece, from));
      const fresh = editing(instance.getJSON());
      expect(tagsIn(instance), `after step ${step}`).toEqual(tagsIn(fresh));
      fresh.destroy();
      editors.pop();
    }
    // 300 fresh editors assert what is drawn, not how fast: about a second
    // alone, but past vitest's 5 s default when the gate shares the machine.
  }, 60_000);
});

describe('what counts as the text a tag is read in', () => {
  it('reads a # after a link as the note’s source reads it: part of the link’s text run', () => {
    const wikiLink = { type: 'wikiLink', attrs: { target: 'Page', heading: null, alias: null } };
    const instance = editing(
      doc(paragraph(text('#before'), wikiLink, text('#after and '), wikiLink, text(' #spaced'))),
    );
    expect(tagsIn(instance)).toEqual([
      ['#before', 'before'],
      ['#spaced', 'spaced'],
    ]);
  });

  it('reads a # right after bold text as a tag, as the index does', () => {
    // `**x**#tag`: the tag's text run starts at its #.
    const instance = editing(doc(paragraph(text('x', [{ type: 'bold' }]), text('#tag'))));
    expect(tagsIn(instance)).toEqual([['#tag', 'tag']]);
  });
});
