// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createReadingExtensions } from './extensions.ts';

/**
 * Links and bookmarks through the clipboard (A22-01). ProseMirror copies a
 * slice as the schema's HTML and parses it back on paste — within one note
 * too — so what a link points at has to survive renderHTML and parseHTML,
 * and a card pasted where a card cannot go has to land somewhere it can.
 */

let editors: Editor[] = [];
afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

// jsdom measures no text: a paste scrolls the caret into view, which asks a range for its boxes.
beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  // jsdom has no ClipboardEvent; `pasteHTML` only makes one to hand to paste handlers.
  if (typeof globalThis.ClipboardEvent === 'undefined') {
    globalThis.ClipboardEvent = class extends Event {
      readonly clipboardData = null;
    } as unknown as typeof ClipboardEvent;
  }
});

const editorWith = (content: JSONContent | string) => {
  const editor = new Editor({
    extensions: createReadingExtensions({ loadImage: async () => null }),
    content,
  });
  editors.push(editor);
  return editor;
};

const ROME = { target: 'Rome', heading: '#Days', alias: 'the days' };
const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

/** The HTML ProseMirror would put on the clipboard for `content`. */
const copied = (...content: JSONContent[]) => editorWith({ type: 'doc', content }).getHTML();

/** Every node in the document, with the types of the nodes it is inside. */
function nodesIn(editor: Editor) {
  const found: { type: string; attrs: Record<string, unknown>; inside: string[] }[] = [];
  editor.state.doc.descendants((node, pos) => {
    const $pos = editor.state.doc.resolve(pos);
    const inside = Array.from({ length: $pos.depth }, (_, d) => $pos.node(d + 1).type.name);
    found.push({ type: node.type.name, attrs: node.attrs, inside });
  });
  return found;
}

/** Pastes `html` with the caret at the end of the first text found inside `container`. */
function pasteInto(editor: Editor, container: string, html: string) {
  let caret = -1;
  editor.state.doc.descendants((node, pos) => {
    if (caret === -1 && node.isTextblock) {
      const $pos = editor.state.doc.resolve(pos + 1);
      const ancestors = Array.from({ length: $pos.depth + 1 }, (_, d) => $pos.node(d).type.name);
      if (ancestors.includes(container)) caret = pos + node.nodeSize - 1;
    }
  });
  expect(caret).toBeGreaterThan(0);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
  editor.view.pasteHTML(html);
}

describe('a wiki link copied and pasted', () => {
  it('keeps the note, heading and alias it links to', () => {
    const html = copied(paragraph(text('See '), { type: 'wikiLink', attrs: ROME }));
    const pasted = nodesIn(editorWith(html)).find((node) => node.type === 'wikiLink');
    expect(pasted?.attrs).toMatchObject({ ...ROME, embed: false });
  });

  it('stays an embed', () => {
    const html = copied(paragraph({ type: 'wikiLink', attrs: { ...ROME, embed: true } }));
    const pasted = nodesIn(editorWith(html)).find((node) => node.type === 'wikiLink');
    expect(pasted?.attrs).toMatchObject({ target: 'Rome', embed: true });
  });

  it('is written without an anchor `target`, which would name a browser window', () => {
    const html = copied(paragraph({ type: 'wikiLink', attrs: ROME }));
    expect(html).toContain('data-wikilink="Rome"');
    expect(html).not.toMatch(/\starget=/);
  });
});

describe('a bookmark pasted where a card cannot go', () => {
  // A22-01's decision: a card is a top-level block only (ADR-0020), so pasted
  // inside another block it goes in as its link, at the caret — never lost,
  // even in a table cell, which ProseMirror will not paste a block out of.
  it.each([
    ['a quote', 'blockquote', { type: 'blockquote', content: [paragraph(text('Quoted'))] }],
    [
      'a list item',
      'listItem',
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('One'))] }] },
    ],
    [
      'a callout',
      'callout',
      {
        type: 'callout',
        attrs: { kind: 'note', title: null, fold: null },
        content: [paragraph(text('Called out'))],
      },
    ],
    [
      'a table cell',
      'tableCell',
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableHeader', content: [paragraph(text('Trip'))] }],
          },
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [paragraph(text('Cell'))] }],
          },
        ],
      },
    ],
  ])('goes in as its link, at the caret, when the caret is in %s', (_where, container, block) => {
    const editor = editorWith({ type: 'doc', content: [block] });
    const before = editor.state.doc.textContent;
    pasteInto(editor, container, copied({ type: 'bookmark', attrs: ROME }));
    const nodes = nodesIn(editor);
    expect(nodes.filter((node) => node.type === 'bookmark')).toEqual([]);
    const links = nodes.filter((node) => node.type === 'wikiLink');
    expect(links).toHaveLength(1);
    expect(links[0]?.attrs).toMatchObject(ROME);
    expect(links[0]?.inside).toContain(container);
    expect(editor.state.doc.textContent).toBe(before);
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it('stays a card when pasted among the note’s own blocks', () => {
    const editor = editorWith({ type: 'doc', content: [paragraph(text('Before'))] });
    pasteInto(editor, 'paragraph', copied({ type: 'bookmark', attrs: ROME }));
    const cards = nodesIn(editor).filter((node) => node.type === 'bookmark');
    expect(cards).toEqual([{ type: 'bookmark', attrs: expect.objectContaining(ROME), inside: [] }]);
  });

  it('keeps its link when HTML from elsewhere holds it inside a quote or a table', () => {
    const card = copied({ type: 'bookmark', attrs: ROME });
    const editor = editorWith(
      `<blockquote>${card}</blockquote><table><tr><td>${card}</td></tr></table>`,
    );
    const nodes = nodesIn(editor);
    expect(nodes.filter((node) => node.type === 'bookmark' && node.inside.length > 0)).toEqual([]);
    const links = nodes.filter((node) => node.type === 'bookmark' || node.type === 'wikiLink');
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link.attrs).toMatchObject({ target: 'Rome' }));
  });
});
