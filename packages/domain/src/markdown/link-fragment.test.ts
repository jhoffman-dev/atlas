import { describe, expect, it } from 'vitest';
import { fragmentHeading, linkFragment } from './link-fragment.ts';
import { readWikiLink } from './wikilink-spans.ts';

/** The fragment of a link as the one link grammar reads it. */
const fragmentOf = (source: string) => {
  const link = readWikiLink(source);
  if (link === null) throw new Error(`not a link: ${source}`);
  return linkFragment(link);
};

describe('linkFragment', () => {
  it('reads `#^id` as a block, embedded or linked', () => {
    expect(fragmentOf('![[Plans#^f3k9x2]]')).toEqual({ kind: 'block', id: 'f3k9x2' });
    expect(fragmentOf('[[Plans#^f3k9x2]]')).toEqual({ kind: 'block', id: 'f3k9x2' });
    expect(fragmentOf('[[Plans#^f3k9x2|the plan]]')).toEqual({ kind: 'block', id: 'f3k9x2' });
  });

  it('reads anything else after `#` as a heading, by its last part', () => {
    expect(fragmentOf('![[Plans#Packing list]]')).toEqual({
      kind: 'heading',
      heading: 'Packing list',
    });
    expect(fragmentOf('[[Plans#Summer#Tents]]')).toEqual({ kind: 'heading', heading: 'Tents' });
  });

  it('reads a caret not followed by an id as a heading that starts with one', () => {
    expect(fragmentOf('[[Plans#^not an id]]')).toEqual({
      kind: 'heading',
      heading: '^not an id',
    });
  });

  it('is null for a link with no fragment, or an empty one', () => {
    expect(fragmentOf('![[Plans]]')).toBeNull();
    expect(fragmentOf('[[Plans#]]')).toBeNull();
    expect(fragmentOf('[[Plans# ]]')).toBeNull();
    expect(linkFragment({ heading: 'no hash' })).toBeNull();
  });

  it('reads a link into the note it is in', () => {
    expect(fragmentOf('![[#^a1]]')).toEqual({ kind: 'block', id: 'a1' });
  });
});

describe('fragmentHeading', () => {
  it('writes the part a link reads back as the same fragment', () => {
    for (const fragment of [
      { kind: 'block', id: 'a1' },
      { kind: 'heading', heading: 'Packing list' },
    ] as const) {
      expect(linkFragment({ heading: fragmentHeading(fragment) })).toEqual(fragment);
    }
    expect(fragmentHeading({ kind: 'block', id: 'a1' })).toBe('#^a1');
  });
});
