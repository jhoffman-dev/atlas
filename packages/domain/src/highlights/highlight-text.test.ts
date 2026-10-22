import { describe, expect, it } from 'vitest';
import { commentLines, plainQuote, quoteLines, undoCommentEscapes } from './highlight-text.ts';

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
    expect(quoteLines('1984.5 was')).toEqual(['1984.5 was']);
    // A paragraph that is only a number and its dot is an empty list item, so it is escaped.
    expect(quoteLines('1984.')).toEqual(['1984\\.']);
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

describe("a comment's Obsidian `%%` marks", () => {
  const written = (comment: string) => commentLines(comment).join('\n');

  it.each([
    ['a balanced pair on one line', 'a %%private%% b'],
    ['a balanced pair across lines', '%%private\nthought%% shown'],
    ['two balanced pairs', '%%a%% and %%b%%'],
    ['four marks, two of them in one run', '%%a%%%%b%%'],
    ['a code span', 'use `x %% y` here'],
    ['a double-backtick span', 'use ``x%%y`` here'],
    ['a fence', '```matlab\n%% Section one\nx = 1;\n```'],
    ['a fence with a blank line in it', '```\n%% one\n\nx\n```'],
    ['a tilde fence', '~~~\n%% one\n~~~'],
    ['a fence never closed', '```\n%% one\nmore %% text'],
    ['an indented code block', 'Example:\n\n    printf("100%%\\n");\n'],
    ['an HTML comment', 'x <!-- 50%% --> y'],
    ['an already escaped pair', 'Up 50%\\% on the year.'],
  ])('keeps %s as written', (_label, comment) => {
    expect(written(comment)).toBe(comment.replace(/\n+$/, ''));
  });

  it.each([
    ['a single mark', 'Up 50%% on the year.', 'Up 50%\\% on the year.'],
    ['a mark outside a code span that holds one', 'a `x %% y` b 50%% c', 'a `x %% y` b 50%\\% c'],
    [
      'a mark after a fence that holds one',
      '```\n%%\n```\nthen %% here',
      '```\n%%\n```\nthen %\\% here',
    ],
    ['a mark beside a backtick with no closer', 'a ` %% b', 'a ` %\\% b'],
    ['three in a row', '50%%% off', '50%\\%\\% off'],
    ['the last of three marks', 'a %%b%% c %%d', 'a %%b%% c %\\%d'],
    ['an earlier run too, when the last holds an even number', '%% a %%%%', '%\\% a %\\%\\%\\%'],
    [
      'a mark after an escaped backtick, which opens no span',
      'a \\`x %% y\\` z',
      'a \\`x %\\% y\\` z',
    ],
    ['the last mark of an odd count held in a long run', '%%%% x %%', '%%%% x %\\%'],
  ])('escapes %s', (_label, comment, expected) => {
    expect(written(comment)).toBe(expected);
  });

  it('never escapes what it wrote again', () => {
    const comments = [
      'Up 50%% on the year.',
      '50%%% off',
      'a %%b%% c %%d',
      '%%%%%',
      '`a` %% ```\n%%\n```\n %%',
      '%\\%\\%',
    ];
    for (const comment of comments) {
      const once = written(comment);
      expect(written(once)).toBe(once);
    }
  });

  it('leaves no unbalanced pair outside code, whatever the comment holds', () => {
    for (const comment of ['%%', '%%%', 'a%%b', '%%%%%', '%%a%%b%%', '`%%` %%']) {
      const marks =
        written(comment)
          .replace(/`[^`]*`/g, '')
          .match(/%%/g) ?? [];
      expect(marks.length % 2).toBe(0);
    }
  });
});

describe('the escapes of a comment undone', () => {
  it.each([
    ['an unbalanced %%', 'Only 50%% of the lamps'],
    ['an unbalanced %%%', 'three %%% here'],
    ['a line that reads as a marker', '<!-- atlas:highlight {"v":1} -->'],
    ['words with nothing to escape', 'a balanced %%private%% and a \\< of its own'],
  ])('gives back the words a comment was written from: %s', (_label, words) => {
    expect(undoCommentEscapes(commentLines(words).join('\n'))).toBe(words);
  });
});
