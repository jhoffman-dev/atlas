// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorDocument, HighlightChip, Transclusion, VaultPath } from '@dfai/domain';
import { NoteEditor, type HighlightLinks } from './note-editor.tsx';

/**
 * A highlight followed back to its place (#506): a shown highlight wears a
 * chip naming its source and page, and a highlight in its own literature
 * note offers "Open in PDF". Both are links the editor follows — with the
 * click's ⌘ or ⌘⇧ — so where they lead is the link rules', not the editor's.
 */

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

describe("a shown highlight's source chip", () => {
  it("names the source's title and page, in its kind's hue, as a link to the reader", async () => {
    renderEditor(EMBED);
    const chip = await screen.findByRole('link', {
      name: 'Open The Lantern Keepers, p. 3 in the reader',
    });
    expect(chip.textContent).toBe('The Lantern Keepersp. 3');
    expect(chip.getAttribute('data-hue')).toBe('red');
    expect(chip.getAttribute('data-source-kind')).toBe('pdf');
    // The chip stands in for the note's name: there is one link to follow, not two.
    expect(screen.queryByRole('link', { name: 'The Lantern Keepers' })).toBeNull();
  });

  it('follows the embed’s link when clicked, here, in a new tab, or beside', async () => {
    const { onFollowLink } = renderEditor(EMBED);
    const chip = await screen.findByRole('link', { name: /in the reader$/ });
    act(() => {
      fireEvent.click(chip);
      fireEvent.click(chip, { metaKey: true });
      fireEvent.click(chip, { metaKey: true, shiftKey: true });
    });
    expect(onFollowLink.mock.calls).toEqual([
      ['The Lantern Keepers', '#^k3x9q2', 'here'],
      ['The Lantern Keepers', '#^k3x9q2', 'new-tab'],
      ['The Lantern Keepers', '#^k3x9q2', 'split'],
    ]);
  });

  it('says a Kindle highlight opens in its note, and names its location', async () => {
    renderEditor(EMBED, {
      transclusion: shown({
        kind: 'kindle',
        hue: 'orange',
        title: 'Brightwater',
        place: 'loc. 41',
        opensInReader: false,
      }),
    });
    const chip = await screen.findByRole('link', { name: 'Open Brightwater, loc. 41 in its note' });
    expect(chip.getAttribute('data-hue')).toBe('orange');
  });

  it('names only the title of a source with no page to name', async () => {
    renderEditor(EMBED, { transclusion: shown({ ...PDF_CHIP, kind: 'epub', place: null }) });
    const chip = await screen.findByRole('link', {
      name: 'Open The Lantern Keepers in the reader',
    });
    expect(chip.textContent).toBe('The Lantern Keepers');
  });

  it('is not worn by a shown block that is no highlight, which keeps its note’s name', async () => {
    renderEditor(EMBED, { transclusion: shown(null) });
    expect(await screen.findByRole('link', { name: 'The Lantern Keepers' })).toBeTruthy();
    expect(document.querySelector('.block-embed__source-chip')).toBeNull();
  });
});

describe('a highlight in its literature note', () => {
  const HIGHLIGHTS = doc(
    { type: 'rawBlock', attrs: { markdown: '> The last lamp', anchor: 'k3x9q2' } },
    { type: 'rawBlock', attrs: { markdown: '> Not one of them', anchor: 'zz9zz9' } },
    { type: 'rawBlock', attrs: { markdown: '<!-- no id -->' } },
  );
  const LINKS: HighlightLinks = { label: 'Open in PDF', ids: new Set(['k3x9q2']) };

  it('offers "Open in PDF" on each highlight the note names, and on no other block', () => {
    renderEditor(HIGHLIGHTS, { highlightLinks: LINKS });
    const offers = screen.getAllByRole('link', { name: 'Open in PDF' });
    expect(offers).toHaveLength(1);
    expect(offers[0]?.closest('pre')?.textContent).toContain('The last lamp');
  });

  it("follows the highlight's own block, here or where the click asked", () => {
    const { onFollowLink } = renderEditor(HIGHLIGHTS, { highlightLinks: LINKS });
    const offer = screen.getByRole('link', { name: 'Open in PDF' });
    act(() => {
      fireEvent.click(offer);
      fireEvent.click(offer, { metaKey: true });
    });
    expect(onFollowLink.mock.calls).toEqual([
      ['', '#^k3x9q2', 'here'],
      ['', '#^k3x9q2', 'new-tab'],
    ]);
  });

  it('offers nothing in a note whose highlights have no reader', () => {
    renderEditor(HIGHLIGHTS);
    expect(document.querySelectorAll('pre[data-raw-block]')).toHaveLength(3);
    expect(screen.queryByRole('link', { name: 'Open in PDF' })).toBeNull();
  });
});
