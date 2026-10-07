import { describe, expect, it } from 'vitest';
import {
  formatWikiLink,
  splitWikiLinks,
  splitWikiLinksAndEmbeds,
  wikiLinkLabel,
} from './wikilink.ts';

const link = (target: string, heading: string | null = null, alias: string | null = null) => ({
  kind: 'wikiLink' as const,
  target,
  heading,
  alias,
});

describe('splitWikiLinks', () => {
  it('returns plain text unchanged as a single piece', () => {
    expect(splitWikiLinks('no links here')).toEqual([{ kind: 'text', value: 'no links here' }]);
  });

  it('finds a simple link', () => {
    expect(splitWikiLinks('[[Note]]')).toEqual([link('Note')]);
  });

  it('keeps the text around a link', () => {
    expect(splitWikiLinks('see [[Note]] for more')).toEqual([
      { kind: 'text', value: 'see ' },
      link('Note'),
      { kind: 'text', value: ' for more' },
    ]);
  });

  it('finds several links in one run', () => {
    expect(splitWikiLinks('[[A]] and [[B]]').filter((p) => p.kind === 'wikiLink')).toHaveLength(2);
  });

  it('reads an alias', () => {
    expect(splitWikiLinks('[[Note|shown text]]')).toEqual([link('Note', null, 'shown text')]);
  });

  it('reads a heading', () => {
    expect(splitWikiLinks('[[Note#Section]]')).toEqual([link('Note', '#Section')]);
  });

  it('reads a heading and an alias together', () => {
    expect(splitWikiLinks('[[Note#Section|shown]]')).toEqual([link('Note', '#Section', 'shown')]);
  });

  it('keeps spaces and unicode in targets', () => {
    expect(splitWikiLinks('[[Daily Notes/año — 日本語]]')).toEqual([
      link('Daily Notes/año — 日本語'),
    ]);
  });

  it('allows an empty alias', () => {
    expect(splitWikiLinks('[[Note|]]')).toEqual([link('Note', null, '')]);
  });

  it.each([
    ['[[]]', 'an empty link'],
    ['[single brackets]', 'single brackets'],
    ['[[unclosed', 'an unclosed link'],
    ['a [[b', 'a stray opener'],
  ])('leaves %j alone (%s)', (text) => {
    expect(splitWikiLinks(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('does not run a link across a closing bracket', () => {
    expect(splitWikiLinks('[[A]] ]] [[B]]').filter((p) => p.kind === 'wikiLink')).toEqual([
      link('A'),
      link('B'),
    ]);
  });

  it('handles an empty string', () => {
    expect(splitWikiLinks('')).toEqual([]);
  });
});

describe('formatWikiLink', () => {
  it.each([
    ['[[Note]]'],
    ['[[Note|shown]]'],
    ['[[Note#Section]]'],
    ['[[Note#Section|shown]]'],
    ['[[Note|]]'],
  ])('writes %s back exactly as it was read', (text) => {
    const [piece] = splitWikiLinks(text);
    expect(piece?.kind).toBe('wikiLink');
    if (piece?.kind !== 'wikiLink') return;
    expect(formatWikiLink(piece)).toBe(text);
  });
});

describe('wikiLinkLabel', () => {
  it('shows the target when there is no alias', () => {
    expect(wikiLinkLabel({ target: 'Note', heading: null, alias: null })).toBe('Note');
  });

  it('shows the alias when there is one', () => {
    expect(wikiLinkLabel({ target: 'Note', heading: null, alias: 'shown' })).toBe('shown');
  });

  it('includes the heading when there is no alias', () => {
    expect(wikiLinkLabel({ target: 'Note', heading: '#Section', alias: null })).toBe(
      'Note#Section',
    );
  });
});

describe('splitWikiLinksAndEmbeds', () => {
  it('reads a `!` right before a link as an embed, taking it out of the text', () => {
    expect(splitWikiLinksAndEmbeds('See ![[chart.png|300]]!')).toEqual([
      { kind: 'text', value: 'See ' },
      { kind: 'wikiLink', target: 'chart.png', heading: null, alias: '300', embed: true },
      { kind: 'text', value: '!' },
    ]);
  });

  it('leaves a link with no `!` a link', () => {
    expect(splitWikiLinksAndEmbeds('[[Plan]]')).toEqual([
      { kind: 'wikiLink', target: 'Plan', heading: null, alias: null, embed: false },
    ]);
  });

  it('writes an embed back with its `!`', () => {
    const embed = { target: 'chart.png', heading: null, alias: '300', embed: true };
    expect(formatWikiLink(embed)).toBe('![[chart.png|300]]');
  });
});
