import { describe, expect, it } from 'vitest';
import { findTags } from './tag-grammar.ts';

/** The names of the tags found in `text`, in order. */
const names = (text: string) => findTags(text).map((tag) => tag.name);

describe('a tag is # followed directly by a word', () => {
  it.each([
    ['#idea', ['idea']],
    ['an #idea here', ['idea']],
    ['#one #two', ['one', 'two']],
    ['#snake_case and #kebab-case', ['snake_case', 'kebab-case']],
    ['#año #日本 #café', ['año', '日本', 'café']],
    ['#v2 and #2fa', ['v2', '2fa']],
    ['#my_tag', ['my_tag']],
    ['line one\n#two', ['two']],
    ['tab\t#after', ['after']],
  ])('%j has %j', (text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it('reports where each tag is, # included', () => {
    expect(findTags('see #idea now')).toEqual([{ start: 4, end: 9, name: 'idea', closed: false }]);
  });

  it('keeps the tag’s own spelling', () => {
    expect(names('#MixedCase')).toEqual(['MixedCase']);
  });

  it.each([
    ['# heading', 'a space after # is a heading'],
    ['## heading', 'two #s are a heading'],
    ['#', 'a # on its own'],
    ['# ', 'a # and a space'],
    ['#123', 'a number is not a tag'],
    ['#2026-09-27', 'nor is a date'],
    ['issue#12', 'a # inside a word'],
    ['C# and F#', 'a language name'],
    ['a#b', 'a # between letters'],
    ['\\#escaped', 'an escaped #'],
    ['&#35;entity', 'an entity'],
    ['#-dash', 'a word may not start with a dash'],
    ['#/slash', 'nor with a slash'],
    ['##double', 'nor after another #'],
    ['#🎉', 'an emoji alone is not a word'],
  ])('%j has none: %s', (text) => {
    expect(names(text)).toEqual([]);
  });

  it('ends at the first character that cannot be in a tag', () => {
    expect(names('#end. #comma, #colon: #bang! #ask? #semi; #quote" #star*')).toEqual([
      'end',
      'comma',
      'colon',
      'bang',
      'ask',
      'semi',
      'quote',
      'star',
    ]);
  });

  it('may follow an opening bracket, and stops at the closing one', () => {
    expect(names('(#aside)')).toEqual(['aside']);
  });

  it('is not started by a # right after other punctuation', () => {
    expect(names('"#quoted" [#bracketed] {#braced}')).toEqual([]);
  });
});

describe('a nested tag uses /', () => {
  it.each([
    ['#para/resource', ['para/resource']],
    ['#a/b/c', ['a/b/c']],
    ['#a/', ['a']],
    ['#a//b', ['a']],
    ['#a/-b', ['a']],
    ['#a/1', ['a/1']],
  ])('%j has %j', (text, expected) => {
    expect(names(text)).toEqual(expected);
  });
});

describe('a multi-word tag closes with # on the same line, as Bear writes it', () => {
  it('reads #tag me# as one tag', () => {
    expect(findTags('#tag me#')).toEqual([{ start: 0, end: 8, name: 'tag me', closed: true }]);
  });

  it.each([
    ['a #tag me# b', ['tag me']],
    ['#one two three#', ['one two three']],
    ['#para/my resource#', ['para/my resource']],
    ['#word#', ['word']],
    ['#tag me#, then #other', ['tag me', 'other']],
    ['(#tag me#)', ['tag me']],
  ])('%j has %j', (text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it('marks a closed single word as closed, so it is written back that way', () => {
    expect(findTags('#word#')[0]?.closed).toBe(true);
  });

  it.each([
    ['#tag me', ['tag'], 'with no closing #, only the first word is the tag'],
    ['#tag1 and #tag2', ['tag1', 'tag2'], 'a closing # must follow a word, not a space'],
    ['#tag\nme#', ['tag'], 'a line break ends it'],
    ['#tag, me#', ['tag'], 'punctuation ends it'],
    ['#a b#c', ['a'], 'a closing # may not run into another word'],
    ['#a / b#', ['a'], 'a nested part may not start or end with a space'],
    ['#a b##', ['a'], 'a closing # may not be doubled'],
  ])('%j has %j: %s', (text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it('is not closed by a one-letter word’s #, which is C# or F#, not a closing #', () => {
    expect(findTags('#todo fix the F# build')).toEqual([
      { start: 0, end: 5, name: 'todo', closed: false },
    ]);
    expect(names('#learn C# today')).toEqual(['learn']);
  });

  it('is still closed after a longer last word, and a one-letter word alone may be closed', () => {
    expect(names('#learn Go# today')).toEqual(['learn Go']);
    expect(names('#a#')).toEqual(['a']);
  });
});

describe('a tag’s name may not start or end with _', () => {
  // `_x_` is emphasis in markdown: a tag spelt that way would not survive a save.
  it.each([
    ['#_private_ note', 'wrapped in _'],
    ['#__init__ note', 'wrapped in __'],
    ['#_private', 'starting with _'],
    ['#_ note', 'only a _'],
    ['#_tag me#', 'a closed tag starting with _'],
  ])('%j has none: %s', (text) => {
    expect(names(text)).toEqual([]);
  });

  it('keeps a _ inside the name', () => {
    expect(names('#snake_case #a__b')).toEqual(['snake_case', 'a__b']);
  });

  it('stops before a _ that ends the word, which is left as text', () => {
    expect(findTags('#draft_ note')).toEqual([{ start: 0, end: 6, name: 'draft', closed: false }]);
    expect(names('#para_/x')).toEqual(['para']);
  });

  it('is not closed when a word of it ends with _', () => {
    expect(names('#tag me_# x')).toEqual(['tag']);
  });
});

describe('a tag is never found inside other markup', () => {
  it.each([
    ['`#code`', 'inline code'],
    ['``a #code b``', 'double-backtick code'],
    ['[[Page#Heading]]', 'a link to a heading'],
    ['[[#Heading]]', 'a link to a heading on the same page'],
    ['[[My #1 note]]', 'a link whose name has a #'],
    ['![[Page#^block]]', 'an embed of a block'],
    ['[[Page| #alias]]', 'an alias'],
    ['[text](#anchor)', 'a link to an anchor'],
    ['[a #word](https://x.com)', 'a link’s text'],
    ['https://example.com/#fragment', 'a URL fragment'],
    ['https://example.com/page #x?', 'x, not the URL'],
    ['www.example.com/#/route', 'a bare URL'],
    ['<span style="color: #fff">', 'an HTML tag'],
  ])('%j (%s)', (text) => {
    const expected = text === 'https://example.com/page #x?' ? ['x'] : [];
    expect(names(text)).toEqual(expected);
  });

  it('still finds a tag beside the markup', () => {
    expect(names('`#code` #real [[A#b]] #also')).toEqual(['real', 'also']);
  });

  it('finds a hex colour in prose, which is a tag there', () => {
    expect(names('the colour #fff')).toEqual(['fff']);
  });
});

describe('reading a long line stays linear in its length', () => {
  // A pasted log or minified file reaches here as one run. Each case is
  // quadratic (or worse) for a backtracking pattern: seconds, not milliseconds.
  const LONG = 80_000;
  it.each([
    ['unclosed brackets', '['.repeat(LONG)],
    ['unclosed angle brackets', '<'.repeat(LONG)],
    ['link text with no link after it', '[a]('.repeat(LONG / 4)],
    ['a run of backticks', '`'.repeat(LONG)],
    [
      'backtick runs of growing length',
      Array.from({ length: 400 }, (_, at) => '`'.repeat(at + 1)).join('x'),
    ],
    ['unclosed comments', '<!--'.repeat(LONG / 4)],
    ['unclosed wiki links', '[[a'.repeat(LONG / 3)],
    ['a URL-like run', 'www.'.repeat(LONG / 4)],
  ])('with %s', (_label, noise) => {
    const started = performance.now();
    expect(names(`#a ${noise}`)).toEqual(['a']);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('properties of the grammar', () => {
  /** A small seeded generator, so a failure is the same failure every run. */
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ALPHABET = [
    '#',
    '#',
    '#',
    ' ',
    'a',
    'B',
    'é',
    '1',
    '/',
    '-',
    '_',
    '`',
    '[',
    ']',
    '\n',
    '.',
    '(',
  ];
  const texts = (() => {
    const random = seeded(20260927);
    return Array.from({ length: 400 }, () =>
      Array.from(
        { length: 1 + Math.floor(random() * 24) },
        () => ALPHABET[Math.floor(random() * ALPHABET.length)],
      ).join(''),
    );
  })();

  it('finds tags in order, without overlap, each starting with # and holding its name', () => {
    for (const text of texts) {
      let previous = 0;
      for (const tag of findTags(text)) {
        expect(tag.start).toBeGreaterThanOrEqual(previous);
        expect(text[tag.start]).toBe('#');
        const written = text.slice(tag.start, tag.end);
        expect(written).toBe(tag.closed ? `#${tag.name}#` : `#${tag.name}`);
        expect(tag.name).toMatch(/\p{L}/u);
        expect(tag.name).not.toMatch(/\n/);
        previous = tag.end;
      }
    }
  });

  it('finds the same tags when the text is read again from its tags alone', () => {
    for (const text of texts) {
      const written = findTags(text)
        .map((tag) => text.slice(tag.start, tag.end))
        .join(' ');
      expect(names(written)).toEqual(names(text));
    }
  });
});
