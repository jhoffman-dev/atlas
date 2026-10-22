import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIGHLIGHT_STYLE,
  quoteSelectorAt,
  type HighlightBlock,
  type PdfAnchor,
} from '@dfai/domain';
import { fakePdf, linesPage } from '../testing/fake-reader.ts';
import { placeHighlights } from './place-highlights.ts';

/*
 * Verification of PR #515 (#504) after ad1cc5f7: a page whose words cannot
 * be read is taken as a page with none, so a highlight made on it is looked
 * for on every other page, and a repeated line elsewhere is then drawn as
 * found exactly — on a page it was never made on. The page is still in the
 * document; only reading it failed. All words are made up.
 */

const LINE = 'A light kept is a promise kept.';
const PAGE_ONE = linesPage('The keepers lit the lamps at dusk.', LINE);
const PAGE_TWO = linesPage('Fog came in from the north channel.', LINE);

const blockOn = (anchor: PdfAnchor): HighlightBlock => ({
  id: 'h1',
  quote: anchor.quote?.exact ?? '',
  comment: '',
  style: DEFAULT_HIGHLIGHT_STYLE,
  anchor,
  start: 0,
  markerEnd: 0,
  quoteEnd: 0,
  end: 0,
});

describe('a highlight whose own page cannot be read stays on that page', () => {
  it('is drawn at its saved boxes on page 1, not as found exactly on page 2', async () => {
    const start = PAGE_ONE.text.indexOf(LINE);
    const anchor: PdfAnchor = {
      kind: 'pdf',
      page: 1,
      quote: quoteSelectorAt({ text: PAGE_ONE.text, start, end: start + LINE.length }),
      rects: [{ x: 0.1, y: 0.13, width: 0.31, height: 0.02 }],
    };
    const document = fakePdf([PAGE_ONE, PAGE_TWO]);
    const unreadable = {
      pageCount: document.pageCount,
      pageText: async (page: number) => {
        if (page === 1) throw new Error('the page’s content stream is damaged');
        return document.pageText(page);
      },
    };
    const [placed] = await placeHighlights({ opened: unreadable, blocks: [blockOn(anchor)] });
    expect(placed?.placement).not.toMatchObject({ kind: 'words', page: 2 });
    expect(placed?.placement).toMatchObject({ kind: 'boxes', page: 1 });
  });
});
