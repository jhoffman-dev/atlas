// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorDocument, HighlightChip, Transclusion, VaultPath } from '@dfai/domain';
import { NoteEditor, type HighlightLinks } from './note-editor.tsx';

/** Set-up shared with note-editor-highlights.test.tsx (#506). */

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const doc = (...content: EditorDocument['content']): EditorDocument => ({ type: 'doc', content });

const PDF_CHIP: HighlightChip = {
  kind: 'pdf',
  hue: 'red',
  title: 'The Lantern Keepers',
  place: 'p. 3',
  opensInReader: true,
};

const shown = (highlight: HighlightChip | null): Transclusion => ({
  kind: 'block',
  path: 'Library/The Lantern Keepers.md' as VaultPath,
  title: 'The Lantern Keepers',
  archived: false,
  fragment: { kind: 'block', id: 'k3x9q2' },
  content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'The last lamp' }] }),
  highlight,
});

const EMBED = doc({
  type: 'blockEmbed',
  attrs: { target: 'The Lantern Keepers', heading: '#^k3x9q2', alias: null },
});

function renderEditor(
  initial: EditorDocument,
  {
    transclusion = shown(PDF_CHIP),
    highlightLinks = null,
  }: { transclusion?: Transclusion; highlightLinks?: HighlightLinks | null } = {},
) {
  const onFollowLink = vi.fn<(target: string, heading?: string | null, how?: string) => void>();
  render(
    <NoteEditor
      doc={initial}
      onChange={() => {}}
      onFollowLink={onFollowLink}
      suggestNotes={() => []}
      loadImage={async () => null}
      transclusions={{ load: async () => transclusion, loadImage: async () => null, revision: 0 }}
      highlightLinks={highlightLinks}
    />,
  );
  return { onFollowLink };
}

/*
 * Regression (#506): the chip and "Open in PDF" are drawn as links —
 * role="link", in the tab order — so a keyboard user reaches them; reached,
 * Enter must follow them as a click does, as a link does everywhere else.
 */

describe("a shown highlight's source chip, from the keyboard", () => {
  it('follows the link on Enter', async () => {
    const { onFollowLink } = renderEditor(EMBED);
    const chip = await screen.findByRole('link', { name: /in the reader$/ });
    chip.focus();
    act(() => {
      fireEvent.keyDown(chip, { key: 'Enter', code: 'Enter' });
    });
    expect(onFollowLink.mock.calls).toEqual([['The Lantern Keepers', '#^k3x9q2', 'here']]);
  });
});

describe('"Open in PDF", from the keyboard', () => {
  const HIGHLIGHTS = doc({
    type: 'rawBlock',
    attrs: { markdown: '> The last lamp', anchor: 'k3x9q2' },
  });
  const LINKS: HighlightLinks = { label: 'Open in PDF', ids: new Set(['k3x9q2']) };

  it('follows the highlight on Enter', () => {
    const { onFollowLink } = renderEditor(HIGHLIGHTS, { highlightLinks: LINKS });
    const offer = screen.getByRole('link', { name: 'Open in PDF' });
    offer.focus();
    act(() => {
      fireEvent.keyDown(offer, { key: 'Enter', code: 'Enter' });
    });
    expect(onFollowLink.mock.calls).toEqual([['', '#^k3x9q2', 'here']]);
  });
});
