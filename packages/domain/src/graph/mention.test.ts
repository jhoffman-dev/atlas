import { describe, expect, it } from 'vitest';
import type { ParsedBody } from '../markdown/source-block.ts';
import { findMention, linkFirstMention, mentionExcerpt, proseRanges } from './mention.ts';

/** The whole body as one prose block. */
const whole = (body: string) => [{ start: 0, end: body.length }];

const link = (body: string, names = ['Atlas'], target = 'Atlas') =>
  linkFirstMention({ body, prose: whole(body), names, target });

describe('linkFirstMention', () => {
  it('turns the first mention into a link and leaves every other byte alone', () => {
    const body = 'We use  Atlas\tdaily.\r\nAtlas again.  \n';
    expect(link(body)).toBe('We use  [[Atlas]]\tdaily.\r\nAtlas again.  \n');
  });

  it('keeps the words as written when they are cased differently', () => {
    expect(link('the atlas app')).toBe('the [[Atlas|atlas]] app');
  });

  it('matches whole words only', () => {
    expect(link('Atlases and MyAtlas and Atlas_x')).toBeNull();
    expect(link('(Atlas).')).toBe('([[Atlas]]).');
  });

  it.each([
    ['inline code', 'run `Atlas` now'],
    ['a longer code span', 'run ``a ` Atlas`` now'],
    ['a wiki link', 'see [[Atlas]] or [[Other|Atlas]]'],
    ['a markdown link', 'see [Atlas](https://x.dev/Atlas)'],
    ['an image', '![Atlas](atlas.png)'],
    ['a reference link', 'see [Atlas][1]'],
    ['a URL', 'at https://example.com/Atlas today'],
    ['a www address', 'at www.atlas.dev/Atlas today'],
    ['HTML', 'a <span title="Atlas">tag</span>'],
    ['a comment', '<!-- Atlas -->'],
    ['maths', 'where $Atlas$ holds'],
    ['an escape', 'a \\Atlas'],
    ['a tag', 'filed under #Atlas today'],
    ['a nested tag', 'filed under #project/Atlas today'],
    ['a shortcut reference', 'see [Atlas] there'],
    ['a footnote reference', 'see [^Atlas] there'],
    ['an email address', 'mail atlas@example.com now'],
    ['a path', 'open src/Atlas/x.md now'],
    ['a file name', 'open Atlas.md now'],
  ])('leaves a mention inside %s alone', (_, body) => {
    expect(link(body)).toBeNull();
  });

  it('skips a shielded mention and links the next plain one', () => {
    expect(link('`Atlas` and Atlas')).toBe('`Atlas` and [[Atlas]]');
  });

  it('looks only in the prose it is given', () => {
    const body = '```\nAtlas\n```\n\nAtlas here';
    const prose = [{ start: 14, end: body.length }];
    expect(linkFirstMention({ body, prose, names: ['Atlas'], target: 'Atlas' })).toBe(
      '```\nAtlas\n```\n\n[[Atlas]] here',
    );
  });

  it('prefers the longer name where two start at the same place', () => {
    expect(link('the Atlas plan', ['Atlas', 'Atlas plan'], 'plan')).toBe('the [[plan|Atlas plan]]');
  });

  it('refuses a target no link could hold, and a name that would break one', () => {
    expect(link('Atlas', ['Atlas'], 'A|B')).toBeNull();
    expect(link('C# notes', ['C#'], 'csharp')).toBeNull();
    expect(link('text', [''], 'x')).toBeNull();
  });
});

describe('findMention', () => {
  it('reports where the mention is in the whole body, and how it is written', () => {
    const body = 'first\n\nthe ATLAS';
    expect(
      findMention({ body, prose: [{ start: 7, end: body.length }], names: ['Atlas'] }),
    ).toEqual({
      start: 11,
      end: 16,
      text: 'ATLAS',
    });
  });
});

describe('proseRanges', () => {
  it('keeps paragraphs, headings, lists and quotes, and leaves code, tables and raw blocks out', () => {
    const types = [
      'paragraph',
      'codeBlock',
      'heading',
      'table',
      'bulletList',
      'rawBlock',
      'blockquote',
    ];
    const parsed: ParsedBody = {
      blocks: types.map((_, index) => ({
        id: `b${index}`,
        index,
        source: '',
        start: index * 10,
        end: index * 10 + 5,
        normalized: '',
      })),
      doc: { type: 'doc', content: types.map((type) => ({ type })) },
    };
    expect(proseRanges(parsed).map((range) => range.start)).toEqual([0, 20, 40, 60]);
  });
});

describe('mentionExcerpt', () => {
  it('shows the words around the mention on one line, marking what was cut', () => {
    const body = `${'x'.repeat(60)} before\nAtlas\nafter ${'y'.repeat(60)}`;
    const start = body.indexOf('Atlas');
    const excerpt = mentionExcerpt(body, { start, end: start + 5 });
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('before Atlas after');
  });

  it('marks nothing when the whole body fits', () => {
    expect(mentionExcerpt('see Atlas', { start: 4, end: 9 })).toBe('see Atlas');
  });
});

describe('linkFirstMention — adversarial', () => {
  // `toLowerCase` turns "İ" (U+0130) into two code units, so an offset found in
  // the lowered text lands one character late in the original.
  it('links the right bytes when earlier text changes length when lowercased', () => {
    expect(link('İzmir trip, then Atlas.')).toBe('İzmir trip, then [[Atlas]].');
  });

  it('never rewrites words that are not the mention when offsets drift', () => {
    // Three "İ" shift the lowered offsets by three: "Go" is found over "on".
    expect(link('İİİ Go on', ['Go'], 'Go')).toBe('İİİ [[Go]] on');
  });

  it('links a name that itself changes length when lowercased', () => {
    expect(link('Off to İzmir soon.', ['İzmir'], 'İzmir')).toBe('Off to [[İzmir]] soon.');
  });

  it('leaves a footnote reference alone', () => {
    expect(link('A claim[^Atlas] here.')).toBeNull();
  });

  it('leaves a hashtag alone', () => {
    expect(link('Filed under #Atlas today.')).toBeNull();
  });
});
