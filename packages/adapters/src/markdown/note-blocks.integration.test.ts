import { describe, expect, it } from 'vitest';
import { noteBlocks } from './note-blocks.ts';

/*
 * `noteBlocks` against the real parser (ADR-0043 §2, §8): which top-level
 * block quotes a note has and what its `%%` comments hide, for every shape
 * the three verification rounds on PR #510 found the line rules got wrong.
 */

const FRONTMATTER = '---\ntype: literature\n---\n';

/** The text of each quote found, and of the paragraph after it. */
function quotesIn(text: string): [string, string | null][] {
  return noteBlocks(text).quotes.map(({ start, end, paragraphAfter }) => [
    text.slice(start, end),
    paragraphAfter === null ? null : text.slice(paragraphAfter.start, paragraphAfter.end),
  ]);
}

const hiddenIn = (text: string): string[] =>
  noteBlocks(text).hidden.map(({ start, end }) => text.slice(start, end));

describe('the block quotes of a note', () => {
  it('finds each top-level quote and the paragraph after it, by offset into the whole note', () => {
    const text = `${FRONTMATTER}> One.\n> Two.\n\n^abc123\n\n# Heading\n\n> Three.\n`;
    expect(quotesIn(text)).toEqual([
      ['> One.\n> Two.', '^abc123'],
      ['> Three.', null],
    ]);
  });

  it('finds none in the frontmatter, and none in an empty note', () => {
    expect(quotesIn('---\nnote: >\n  folded\n---\n')).toEqual([]);
    expect(quotesIn('')).toEqual([]);
    expect(quotesIn('---\ntype: literature\n---')).toEqual([]);
  });

  it('reads an unclosed frontmatter as body, as the note renders', () => {
    expect(quotesIn('---\n> Quote.\n')).toEqual([['> Quote.', null]]);
  });

  it('gives no paragraph after a quote followed by another kind of block', () => {
    expect(quotesIn('> Q.\n\n- ^abc123\n')).toEqual([['> Q.', null]]);
    expect(quotesIn('> Q.\n\n```\n^abc123\n```\n')).toEqual([['> Q.', null]]);
  });

  it('takes a quote straight after a paragraph line as a quote, which CommonMark lets interrupt it', () => {
    expect(quotesIn('Words.\n> Quote.\n')).toEqual([['> Quote.', null]]);
  });

  it('takes a `>` indented up to three spaces as a quote, and four as code (verify2 R2)', () => {
    expect(quotesIn('   > Quote.\n')).toEqual([['> Quote.', null]]);
    expect(quotesIn('    > Code.\n')).toEqual([]);
    expect(quotesIn('> Mine.\n  > And more.\n\n^abc123\n')).toEqual([
      ['> Mine.\n  > And more.', '^abc123'],
    ]);
  });

  it('keeps a lazy line in the quote, and ends it at a line that starts a block (verify R2)', () => {
    expect(quotesIn('> A comment,\ngoing on.\n')).toEqual([['> A comment,\ngoing on.', null]]);
    expect(quotesIn('> A comment,\n# Heading\n')).toEqual([['> A comment,', null]]);
    // CommonMark: a list item line outside the quote starts a list, numbered 1 or not.
    expect(quotesIn('> A comment,\n2. more\n')).toEqual([['> A comment,', null]]);
    expect(quotesIn('> A comment,\n-\n')).toEqual([['> A comment,', null]]);
  });

  it('finds no quote in a list item, a fence, an HTML block or indented code', () => {
    expect(quotesIn('- > In a list.\n')).toEqual([]);
    expect(quotesIn('```\n> In a fence.\n```\n')).toEqual([]);
    expect(quotesIn('<div>\n> In HTML.\n</div>\n')).toEqual([]);
    expect(quotesIn('    > In code.\n')).toEqual([]);
  });

  it.each([
    ['a fence', '```js\nlet draft;\n'],
    ['an HTML comment', '<!-- a draft\n'],
    ['a <pre> block', '<pre>\nkept\n'],
    ['a <script> block', '<script>\nrun();\n'],
  ])('finds no quote after %s nobody closed, which runs to the end (verify R1)', (_, open) => {
    expect(quotesIn(`${open}\n> Quote.\n\n^abc123\n`)).toEqual([]);
  });

  it('ends a fence in a list item with the item, so the quote after it is one (verify R1)', () => {
    expect(quotesIn('- Step one\n  ```sh\n  make draft\n\n> Quote.\n')).toEqual([
      ['> Quote.', null],
    ]);
  });

  it('reads a note saved on Windows, and one that starts with a byte-order mark', () => {
    expect(quotesIn('> Q.\r\n\r\n^abc123\r\n')).toEqual([['> Q.', '^abc123']]);
    expect(quotesIn('\uFEFF> Q.\n\n^abc123\n')).toEqual([['> Q.', '^abc123']]);
    expect(quotesIn(`\uFEFF${FRONTMATTER}> Q.\n`)).toEqual([['> Q.', null]]);
  });
});

describe('what Obsidian `%%` comments hide', () => {
  it('hides from one `%%` to the next, across blocks', () => {
    expect(hiddenIn('Words %%aside%% more.\n')).toEqual(['%%aside%%']);
    expect(hiddenIn('%%\nA thought.\n\n> Quote.\n%%\nAfter.\n')).toEqual([
      '%%\nA thought.\n\n> Quote.\n%%',
    ]);
  });

  it('hides to the end of the note from a `%%` nobody closed', () => {
    const text = 'Before.\n\n%%\nA private thought.\n';
    expect(hiddenIn(text)).toEqual(['%%\nA private thought.\n']);
  });

  it('opens a comment at a `%%` in the words of a quote', () => {
    const text = '> A thought %% to hide\n\nAfter.\n';
    expect(hiddenIn(text)).toEqual(['%% to hide\n\nAfter.\n']);
  });

  it.each([
    ['a fence', '```matlab\n%% Section one\n```\n'],
    ['a fence in a quote (verify2 R1)', '> [!example]\n> ```matlab\n> %% Section one\n> ```\n'],
    ['indented code (verify2 R1)', 'Example:\n\n    printf("100%%\\n");\n'],
    ['a code span', 'Type `%%` to comment.\n'],
    ['a double-backtick code span (verify2 R1)', 'Escape it as ``%%`` in a format string.\n'],
    ['an HTML comment', '<!-- 50%% -->\n'],
    ['inline HTML', 'A <span title="%%">word</span>.\n'],
    ['a marker', '> Q.\n> <!-- atlas:highlight {"v":1,"exact":"50%% off"} -->\n'],
  ])('hides nothing for a `%%` inside %s', (_, text) => {
    expect(hiddenIn(`${text}\nAfter.\n`)).toEqual([]);
  });

  it('closes a comment at the next `%%` in words, not at one inside code it holds (an approximation)', () => {
    const text = '%%\n```\n%% in code\n```\n%%\nShown.\n';
    expect(hiddenIn(text)).toEqual(['%%\n```\n%% in code\n```\n%%']);
  });

  it('gives offsets into the whole note, frontmatter included', () => {
    const text = `${FRONTMATTER}Words %%aside%%.\n`;
    const [span] = noteBlocks(text).hidden;
    expect(span?.start).toBe(text.indexOf('%%'));
  });
});
