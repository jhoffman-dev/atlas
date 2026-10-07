import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/vault-path.ts';
import { findTags } from '../tags/tag-grammar.ts';
import { plainText } from './plain-text.ts';
import { notesAfterMove, retargetLinks } from './retarget-links.ts';
import { splitWikiLinks, splitWikiLinksAndEmbeds } from './wikilink.ts';

/**
 * One wiki-link grammar, read the same by the index, a rename, plain text and
 * tags as by the editor (A21-04, ADR-0004): escapes, line breaks, code and
 * comments decide what is a link identically everywhere.
 */

const targets = (markdown: string): string[] =>
  splitWikiLinks(markdown).flatMap((piece) => (piece.kind === 'wikiLink' ? [piece.target] : []));

describe('what the link grammar reads as a link', () => {
  it.each([
    ['an escaped first bracket', 'See \\[[Plan]] here.', []],
    ['an escaped backslash before the brackets', 'See \\\\[[Plan]] here.', ['Plan']],
    ['a link broken over a line', 'See [[Plan\nNext]] here.', []],
    ['a link broken over a CRLF line', 'See [[Plan\r\nNext]] here.', []],
    ['a link in a code span', 'See `[[Plan]]` here.', []],
    ['a link in a fenced code block', '```\n[[Plan]]\n```\n\n[[Real]]\n', ['Real']],
    ['a link in a comment', 'See <!-- [[Plan]] --> [[Real]]', ['Real']],
    // A comment that starts its line is an HTML block, to the end of that line.
    ['a link after a comment that starts its line', '<!-- x --> [[Plan]]\n[[Real]]', ['Real']],
    ['a link whose name holds `<!--`', '[[a<!--b]] <!-- atlas:bookmark -->', ['a<!--b']],
    ['a lone backtick in a name, with no code span to close', 'See [[a`b]] here.', ['a`b']],
    ['a code span that opens inside a link and closes after it', 'See [[a`b]] c` d.', []],
    ['a code span that opens and closes inside a link', 'See [[a`b`c]] d.', ['a`b`c']],
    ['a code span that opens inside a link, past one closed in it', 'See [[a`b`c`]] d` e.', []],
    ['a code span opened before a link and closed in it', 'See `a [[b` c]] d.', []],
    ['an escaped backtick in a name', 'See [[a\\`b]] c` d.', ['a\\`b']],
    ['a backtick closed only past the paragraph', 'See [[a`b]] c.\n\nd` e.', ['a`b']],
    ['a backtick closed only in the next list item', '- [[a`b]] c\n- d` e', ['a`b']],
  ])('%s', (_, markdown, expected) => {
    expect(targets(markdown)).toEqual(expected);
  });

  it('reads `\\|` in a link as its alias pipe, in a table or not', () => {
    expect(splitWikiLinks('[[Plan\\|the plan]]')).toEqual([
      { kind: 'wikiLink', target: 'Plan', heading: null, alias: 'the plan' },
    ]);
  });

  it('reads an escaped `!` before a link as text, not as an embed', () => {
    const [bang, link] = splitWikiLinksAndEmbeds('\\![[img.png]]');
    expect(bang).toEqual({ kind: 'text', value: '\\!' });
    expect(link).toMatchObject({ kind: 'wikiLink', target: 'img.png', embed: false });
  });
});

describe('a rename rewrites exactly the links the grammar reads', () => {
  const renamed = (text: string): string =>
    retargetLinks({
      text,
      path: 'Holder.md' as VaultPath,
      exists: () => false,
      ...notesAfterMove({ from: 'Plan.md' as VaultPath, to: 'Roadmap.md' as VaultPath }, [
        'Plan.md',
        'Holder.md',
      ] as VaultPath[]),
    }).text;

  it.each([
    ['an escaped link', 'See \\[[Plan]].\n'],
    ['a link broken over a line', 'See [[Plan\nx]].\n'],
    ['a link in a comment', '<!-- [[Plan]] -->\n'],
    ['a link a code span runs through', 'See [[Plan`]] x`.\n'],
  ])('and leaves %s alone', (_, text) => {
    expect(renamed(text)).toBe(text);
  });

  it('keeps an escaped alias pipe as written', () => {
    expect(renamed('See [[Plan\\|the plan]].\n')).toBe('See [[Roadmap\\|the plan]].\n');
  });
});

describe('tags read around links as the grammar reads them', () => {
  const names = (text: string) => findTags(text).map((tag) => tag.name);

  it('finds a tag in escaped brackets, which are no link', () => {
    expect(names('\\[[a #b]]')).toEqual(['b']);
  });

  it('finds a tag on the line after an unclosed link', () => {
    expect(names('[[a\n#b]]')).toEqual(['b']);
  });
});

describe('plain text reads links as the grammar reads them', () => {
  it('keeps a link whose name holds `<!--`, dropping the comment after it', () => {
    expect(plainText('[[a<!--b]] <!-- atlas:bookmark -->')).toBe('a<!--b');
  });

  it('reads an aliased link with an escaped pipe as its alias', () => {
    expect(plainText('See [[Plan\\|the plan]]')).toBe('See the plan');
  });
});
