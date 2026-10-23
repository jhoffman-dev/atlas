import { describe, expect, it } from 'vitest';
import type { HighlightBlock } from './highlight-block.ts';
import { isTombstoneBlock, kindleTombstoneLine } from './highlight-marker.ts';
import { highlightView } from './highlight-view.ts';

/*
 * A highlight as the editor draws it (#523): the quote's words, a picture for
 * an area, the comment as written, and the mark — never the marker.
 */

const block = (overrides: Partial<HighlightBlock>): HighlightBlock => ({
  id: 'k3x9q2',
  quote: 'All warfare is based on deception.',
  comment: '',
  style: { mark: 'highlight', color: 'yellow' },
  anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: null },
  start: 0,
  markerEnd: 0,
  quoteEnd: 0,
  end: 0,
  ...overrides,
});

describe('highlightView', () => {
  it('shows the words the quote reads as, its escapes taken off', () => {
    const view = highlightView(
      block({ quote: 'Use \\*all\\* of it, \\#tactics and 50\\%\\% \\^ok' }),
    );
    expect(view.words).toBe('Use *all* of it, #tactics and 50%% ^ok');
    expect(view.picture).toBeNull();
  });

  it('keeps each paragraph of the quote on a line of its own', () => {
    expect(highlightView(block({ quote: 'First.\nSecond.' })).words).toBe('First.\nSecond.');
  });

  it("shows an area's picture, and no words", () => {
    const view = highlightView(
      block({ quote: '![[attachments/The Lantern Keepers p4 area.png]]' }),
    );
    expect(view).toMatchObject({
      picture: 'attachments/The Lantern Keepers p4 area.png',
      words: '',
    });
  });

  it('shows the words after a picture, and finds a picture in any case of extension', () => {
    const view = highlightView(block({ quote: '![[scan p2.PNG]]\nThe caption.' }));
    expect(view).toMatchObject({ picture: 'scan p2.PNG', words: 'The caption.' });
  });

  it.each([
    ['an embed of a note', '![[Field notes]]'],
    ['a link to a picture', '[[scan.png]]'],
    ['an embed of a block of a picture', '![[scan.png#^abc123]]'],
    ['a picture among words on its line', 'See ![[scan.png]] here'],
  ])('reads %s as words, not a picture', (_label, quote) => {
    const view = highlightView(block({ quote }));
    expect(view.picture).toBeNull();
    expect(view.words).not.toBe('');
  });

  it('shows the comment exactly as the file holds it, its escapes visible (#534)', () => {
    // Shown unescaped, a later edit could turn a person's own `%\\%` into a hidden `%%`.
    const written = 'Compare [[Larkspur Payroll]]. 50%\\% sure.\n\n**Second** thought.';
    expect(highlightView(block({ comment: written })).comment).toBe(written);
  });

  it('draws the mark and colour the marker gives', () => {
    const view = highlightView(block({ style: { mark: 'underline', color: 'purple' } }));
    expect(view).toMatchObject({ id: 'k3x9q2', mark: 'underline', color: 'purple' });
  });
});

describe('isTombstoneBlock', () => {
  const tombstone = kindleTombstoneLine({
    anchor: { kind: 'kindle', location: { start: 9, end: 9 }, annotationId: 'A1' },
    words: 'Gone now.',
  });

  it.each([
    ['a tombstone', tombstone],
    ['a tombstone with a Windows line ending', `${tombstone}\r\n`],
    ['two tombstones, one after the other', `${tombstone}\n${tombstone}`],
    ['a tombstone indented three spaces', `   ${tombstone}`],
    ['a newer version’s tombstone', '<!-- atlas:highlight-removed {"v":2,"kind":"kindle"} -->'],
  ])('hides %s', (_label, markdown) => {
    expect(isTombstoneBlock(markdown)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a highlight marker', '<!-- atlas:highlight {"v":1} -->'],
    ['another comment', '<!-- atlas:summary -->'],
    ['a tombstone with words after it', `${tombstone}\nWords.`],
    ['a quoted tombstone, which is the person’s words', `> ${tombstone}`],
  ])('shows %s', (_label, markdown) => {
    expect(isTombstoneBlock(markdown)).toBe(false);
  });
});
