import { describe, expect, it } from 'vitest';
import { commentLines, plainQuote, quoteLines } from './highlight-text.ts';

describe("a quote's lines", () => {
  it('is one line per paragraph, its line breaks and runs of spaces made one space', () => {
    expect(
      quoteLines('It was the best\nof times,  it was\r\nthe worst.\n\n  Second  part. '),
    ).toEqual(['It was the best of times, it was the worst.', 'Second part.']);
  });

  it('has no lines for words that are only whitespace', () => {
    expect(quoteLines(' \n\n\t ')).toEqual([]);
  });

  it.each([
    ['emphasis', 'a *b* _c_', 'a \\*b\\* \\_c\\_'],
    ['a tag', 'see #chapter', 'see \\#chapter'],
    ['a heading', '# Title', '\\# Title'],
    ['an Obsidian highlight', '==loud==', '\\=\\=loud\\=\\='],
    ['an Obsidian comment', '50%% off', '50\\%\\% off'],
    ['a block id', 'the end ^abc123', 'the end \\^abc123'],
    ['a wiki link', '[[Moby Dick]]', '\\[\\[Moby Dick\\]\\]'],
    ['HTML', '<b>bold</b>', '\\<b\\>bold\\</b\\>'],
    ['code', 'use `x`', 'use \\`x\\`'],
    ['a table pipe', 'a | b', 'a \\| b'],
    ['strikethrough', '~~gone~~', '\\~\\~gone\\~\\~'],
    ['maths', '$x$', '\\$x\\$'],
    ['an entity', 'fish &amp; chips', 'fish \\&amp; chips'],
    ['a backslash', 'a\\b', 'a\\\\b'],
    ['a list item', '- one', '\\- one'],
    ['a plus list item', '+ one', '\\+ one'],
    ['a rule', '---', '\\---'],
    ['an ordered item', '12. twelve', '12\\. twelve'],
    ['an ordered item with a bracket', '3) three', '3\\) three'],
  ])('escapes %s', (_label, words, line) => {
    expect(quoteLines(words)).toEqual([line]);
  });

  it('leaves a dash or number mid-line, and a number with no space after, alone', () => {
    expect(quoteLines('well - maybe 3. or 4.5')).toEqual(['well - maybe 3. or 4.5']);
    expect(quoteLines('1984.')).toEqual(['1984.']);
  });

  it('shows the words again once its escapes are taken off', () => {
    const words = 'a *b* #c ==d== %%e%% [[f]] <g> `h` | ~i~ $j$ &k; \\l ^m';
    expect(plainQuote(quoteLines(words).join('\n'))).toBe(words);
    expect(plainQuote(quoteLines('- 1. x').join('\n'))).toBe('- 1. x');
  });
});

describe("a comment's lines", () => {
  it("keeps the person's markdown, one kind of line ending, no blank lines at either end", () => {
    expect(commentLines('\n\n**Why** it matters:\r\n\r\n- one\r- two\n\n')).toEqual([
      '**Why** it matters:',
      '',
      '- one',
      '- two',
    ]);
  });

  it('is nothing for a blank comment', () => {
    expect(commentLines('  \n \n')).toEqual([]);
  });

  it('escapes a line that would read as a second marker', () => {
    expect(commentLines('<!-- atlas:highlight {"v":1} -->\nok')).toEqual([
      '\\<!-- atlas:highlight {"v":1} -->',
      'ok',
    ]);
  });
});
