// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EditorDocument, HighlightView, Transclusion, VaultPath } from '@dfai/domain';
import { NoteEditor, type HighlightLinks, type NoteHighlights } from './note-editor.tsx';

/**
 * A highlight drawn as a quote with its comment (#523): in its literature
 * note the comment is a field written through the note's own write, the
 * marker and tombstones are never drawn, and an embed draws the same quote,
 * read-only, under its source chip.
 */

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const doc = (...content: EditorDocument['content']): EditorDocument => ({ type: 'doc', content });

const MARKER =
  '<!-- atlas:highlight {"v":1,"mark":"underline","color":"green","kind":"kindle","location":41} -->';
const TOMBSTONE =
  '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":9,"words":"3f2a"} -->';
const block = (quote: string, comment: string) =>
  [`> ${quote}`, `> ${MARKER}`, ...(comment === '' ? [] : ['>', `> ${comment}`])].join('\n');

/**
 * A stand-in for the application's reader: the words before the marker, the
 * line after the blank one — read from the block itself, as the real one is.
 */
const viewOf = ({ markdown, id }: { markdown: string; id: string }): HighlightView | null => {
  const lines = markdown.split('\n').map((line) => line.replace(/^> ?/, ''));
  const at = lines.findIndex((line) => line.startsWith('<!-- atlas:highlight '));
  if (at < 1 || id === 'zz9zz9') return null;
  return {
    id,
    words: lines.slice(0, at).join('\n'),
    picture: lines[0]?.startsWith('![[') ? lines[0].slice(3, -2) : null,
    comment: lines.slice(at + 2).join('\n'),
    mark: 'underline',
    color: 'green',
  };
};

const NOTE = doc(
  {
    type: 'rawBlock',
    attrs: { markdown: block('The last lamp.', 'Lit by Mara.'), anchor: 'k3x9q2' },
  },
  { type: 'rawBlock', attrs: { markdown: TOMBSTONE } },
  { type: 'rawBlock', attrs: { markdown: '| a | b |\n| - | - |' } },
  { type: 'paragraph', content: [{ type: 'text', text: 'My own words.' }] },
);

function renderNote(
  initial: EditorDocument,
  {
    editComment = vi.fn(async () => {}),
    highlightLinks = null,
    transclusion,
    loadImage = async () => null,
  }: {
    editComment?: NoteHighlights['editComment'];
    highlightLinks?: HighlightLinks | null;
    transclusion?: Transclusion;
    loadImage?: (src: string) => Promise<string | null>;
  } = {},
) {
  const onChange = vi.fn();
  const props = {
    onChange,
    onFollowLink: vi.fn(),
    suggestNotes: () => [],
    loadImage,
    highlights: { viewOf, editComment },
    highlightLinks,
    ...(transclusion !== undefined && {
      transclusions: {
        load: async () => transclusion,
        loadImage: ({ src }: { src: string }) => loadImage(src),
        revision: 0,
      },
    }),
  };
  const view = render(<NoteEditor doc={initial} {...props} />);
  const rerender = (next: EditorDocument) => view.rerender(<NoteEditor doc={next} {...props} />);
  return { onChange, editComment, rerender, onFollowLink: props.onFollowLink };
}

const field = () => screen.getByRole('textbox', { name: 'Comment on this highlight' });

describe('a highlight in its literature note', () => {
  it('draws its quote and its comment, and never its marker', async () => {
    renderNote(NOTE);
    const quote = await screen.findByText('The last lamp.');
    expect(quote.closest('blockquote')).not.toBeNull();
    expect(quote.closest('.highlight-quote')?.getAttribute('data-mark')).toBe('underline');
    expect(quote.closest('.highlight-quote')?.getAttribute('data-color')).toBe('green');
    expect((field() as HTMLTextAreaElement).value).toBe('Lit by Mara.');
    const editor = document.querySelector('.editor') as HTMLElement;
    expect(editor.textContent).toContain('The last lamp.');
    expect(editor.textContent).not.toContain('atlas:highlight {');
  });

  it("hides a removed highlight's tombstone, and still shows other blocks as source", () => {
    renderNote(NOTE);
    const blocks = [...document.querySelectorAll('pre[data-raw-block]')];
    expect(blocks.map((pre) => pre.className)).toEqual([
      'raw-block raw-block--comment raw-block--hidden',
      'raw-block',
    ]);
    expect(blocks[1]?.textContent).toContain('| a | b |');
  });

  it('draws as its source a quote the note does not read as a highlight', () => {
    renderNote(
      doc({ type: 'rawBlock', attrs: { markdown: block('Hidden.', ''), anchor: 'zz9zz9' } }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('pre[data-raw-block]')?.textContent).toContain('atlas:highlight');
  });

  it('writes the comment typed when the field is left, and only when it changed', async () => {
    const { editComment, onChange } = renderNote(NOTE);
    act(() => {
      fireEvent.focus(field());
      fireEvent.blur(field());
    });
    expect(editComment).not.toHaveBeenCalled();
    act(() => {
      fireEvent.change(field(), { target: { value: 'Lit by Mara Quill.\nTwice.' } });
      fireEvent.blur(field());
    });
    await waitFor(() =>
      expect(editComment).toHaveBeenCalledWith({
        id: 'k3x9q2',
        base: 'Lit by Mara.',
        comment: 'Lit by Mara Quill.\nTwice.',
      }),
    );
    // The editor's own save never sees it: the note's write does.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('writes on ⌘↩, and Escape puts the comment back unwritten', async () => {
    const { editComment } = renderNote(NOTE);
    act(() => {
      field().focus();
      fireEvent.change(field(), { target: { value: 'Draft.' } });
      // Escape leaves the field too: the blur it makes must not write the draft.
      fireEvent.keyDown(field(), { key: 'Escape' });
    });
    expect(document.activeElement).not.toBe(field());
    expect((field() as HTMLTextAreaElement).value).toBe('Lit by Mara.');
    expect(editComment).not.toHaveBeenCalled();
    act(() => {
      fireEvent.change(field(), { target: { value: 'Kept.' } });
      fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    });
    await waitFor(() =>
      expect(editComment).toHaveBeenCalledWith({
        id: 'k3x9q2',
        base: 'Lit by Mara.',
        comment: 'Kept.',
      }),
    );
  });

  it('keeps what was typed and says why when the write is refused', async () => {
    const editComment = vi.fn(async () => {
      throw new Error('“Brightwater” has unsaved typing in another pane.');
    });
    renderNote(NOTE, { editComment });
    act(() => {
      fireEvent.change(field(), { target: { value: 'Not lost.' } });
      fireEvent.blur(field());
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      '“Brightwater” has unsaved typing in another pane.',
    );
    expect((field() as HTMLTextAreaElement).value).toBe('Not lost.');
  });

  it('shows the comment the note was read again with, once it is written', async () => {
    const { rerender } = renderNote(NOTE);
    await screen.findByText('The last lamp.');
    rerender(
      doc({
        type: 'rawBlock',
        attrs: { markdown: block('The last lamp.', 'Written by the note.'), anchor: 'k3x9q2' },
      }),
    );
    await waitFor(() =>
      expect((field() as HTMLTextAreaElement).value).toBe('Written by the note.'),
    );
  });

  it('keeps keys typed in the field out of the note', () => {
    const { onChange } = renderNote(NOTE);
    for (const key of ['Backspace', 'Enter', 'a', 'Delete']) {
      fireEvent.keyDown(field(), { key });
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('.editor')?.textContent).toContain('My own words.');
  });

  it('still offers "Open in PDF", which follows the highlight’s own block', () => {
    const { onFollowLink } = renderNote(NOTE, {
      highlightLinks: { label: 'Open in PDF', ids: new Set(['k3x9q2']) },
    });
    const offer = screen.getByRole('link', { name: 'Open in PDF' });
    expect(offer.closest('[data-highlight-block]')?.getAttribute('data-highlight-block')).toBe(
      'k3x9q2',
    );
    act(() => fireEvent.click(offer, { metaKey: true }));
    expect(onFollowLink).toHaveBeenCalledWith('', '#^k3x9q2', 'new-tab');
  });

  it("draws an area highlight's picture, found as the note's images are", async () => {
    const loadImage = vi.fn(async (src: string) => `blob:${src}`);
    renderNote(
      doc({
        type: 'rawBlock',
        attrs: { markdown: block('![[attachments/p4 area.png]]', ''), anchor: 'k3x9q2' },
      }),
      { loadImage },
    );
    const picture = await screen.findByRole('img', { name: 'The highlighted area' });
    expect(picture.getAttribute('src')).toBe('blob:attachments/p4 area.png');
  });
});

describe('a highlight shown in another note', () => {
  const VIEW: HighlightView = {
    id: 'k3x9q2',
    words: 'The last lamp.',
    picture: null,
    comment: 'Lit by Mara.',
    mark: 'highlight',
    color: 'pink',
  };
  const shown: Transclusion = {
    kind: 'block',
    path: 'Library/The Lantern Keepers.md' as VaultPath,
    title: 'The Lantern Keepers',
    archived: false,
    fragment: { kind: 'block', id: 'k3x9q2' },
    content: doc({
      type: 'rawBlock',
      attrs: { markdown: block('The last lamp.', 'Lit by Mara.') },
    }),
    highlight: {
      kind: 'pdf',
      hue: 'red',
      title: 'The Lantern Keepers',
      place: 'p. 3',
      opensInReader: true,
    },
    highlightView: VIEW,
  };
  const EMBED = doc({
    type: 'blockEmbed',
    attrs: { target: 'The Lantern Keepers', heading: '#^k3x9q2', alias: null },
  });

  it('draws its quote and comment, read-only, under its source chip, and never its marker', async () => {
    renderNote(EMBED, { transclusion: shown });
    const quote = await screen.findByText('The last lamp.');
    const embed = quote.closest('[data-block-embed]') as HTMLElement;
    expect(embed.querySelector('.highlight-quote')?.getAttribute('data-color')).toBe('pink');
    expect(embed.textContent).toContain('Lit by Mara.');
    expect(embed.textContent).not.toContain('atlas:highlight');
    expect(embed.querySelector('textarea')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open The Lantern Keepers, p. 3 in the reader' }),
    ).toBeTruthy();
  });
});
