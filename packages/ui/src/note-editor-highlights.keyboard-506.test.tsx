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
  highlightView: null,
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

describe('the name of an embedded block that is no highlight, from the keyboard', () => {
  it('follows the link on Enter, and in a new tab on Meta+Enter', async () => {
    const { onFollowLink } = renderEditor(EMBED, { transclusion: shown(null) });
    const name = await screen.findByRole('link', { name: 'The Lantern Keepers' });
    name.focus();
    act(() => {
      fireEvent.keyDown(name, { key: 'Enter', code: 'Enter' });
      fireEvent.keyDown(name, { key: 'Enter', code: 'Enter', metaKey: true });
    });
    expect(onFollowLink.mock.calls).toEqual([
      ['The Lantern Keepers', '#^k3x9q2', 'here'],
      ['The Lantern Keepers', '#^k3x9q2', 'new-tab'],
    ]);
  });
});

describe('keys that are not a link being followed', () => {
  it('leaves other keys on a link alone, and Enter typed in the text itself', async () => {
    const { onFollowLink } = renderEditor(EMBED);
    const chip = await screen.findByRole('link', { name: /in the reader$/ });
    act(() => {
      fireEvent.keyDown(chip, { key: 'a', code: 'KeyA' });
      fireEvent.keyDown(chip, { key: ' ', code: 'Space' });
      fireEvent.keyDown(document.querySelector('.ProseMirror') as HTMLElement, {
        key: 'Enter',
        code: 'Enter',
      });
    });
    expect(onFollowLink).not.toHaveBeenCalled();
  });
});

/*
 * Regression (PR #522): the embed is a React node view whose stopEvent keeps
 * ProseMirror's handlers from keys pressed on its name and chip, so the
 * browser's own answer to them ran — Backspace went Back in WebKit, ⌘Z was
 * WebKit's undo and moved the page's selection into the text. Each is
 * prevented on the embed's links, while the app's shortcuts are left alone.
 */

/** A key pressed on `target`, said by whether the browser's own answer to it was prevented. */
function prevented(target: HTMLElement, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const BROWSER_KEYS: readonly [string, KeyboardEventInit][] = [
  ['Backspace', { key: 'Backspace' }],
  ['Delete', { key: 'Delete' }],
  ['a typed letter', { key: 'x' }],
  ['Space', { key: ' ' }],
  ['Meta+z', { key: 'z', metaKey: true }],
  ['Meta+Shift+z', { key: 'z', metaKey: true, shiftKey: true }],
  ['Meta+b', { key: 'b', metaKey: true }],
  ['Ctrl+z', { key: 'z', ctrlKey: true }],
];

const embedLinks = {
  "an embed's name": async () => {
    const { onFollowLink } = renderEditor(EMBED, { transclusion: shown(null) });
    return { link: await screen.findByRole('link', { name: 'The Lantern Keepers' }), onFollowLink };
  },
  "a shown highlight's chip": async () => {
    const { onFollowLink } = renderEditor(EMBED);
    return { link: await screen.findByRole('link', { name: /in the reader$/ }), onFollowLink };
  },
};

for (const [where, linkIn] of Object.entries(embedLinks)) {
  describe(`keys the browser would answer itself, pressed on ${where}`, () => {
    for (const [named, init] of BROWSER_KEYS) {
      it(`${named} is kept from the browser, and follows nothing`, async () => {
        const { link, onFollowLink } = await linkIn();
        expect(prevented(link, init)).toBe(true);
        expect(onFollowLink).not.toHaveBeenCalled();
      });
    }

    it('leaves an app shortcut, Meta+k, to the app', async () => {
      const { link } = await linkIn();
      expect(prevented(link, { key: 'k', metaKey: true })).toBe(false);
    });

    it('still follows the link on Enter, once', async () => {
      const { link, onFollowLink } = await linkIn();
      expect(prevented(link, { key: 'Enter' })).toBe(true);
      expect(onFollowLink.mock.calls).toEqual([['The Lantern Keepers', '#^k3x9q2', 'here']]);
    });
  });
}
