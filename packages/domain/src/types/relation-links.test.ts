import { describe, expect, it } from 'vitest';
import { holdsOnlyText, linkedNotes, withLink, withoutLink } from './relation-links.ts';

describe('linkedNotes', () => {
  it('reads nothing, one link or a list of them as a list', () => {
    expect(linkedNotes(null)).toEqual([]);
    expect(linkedNotes('')).toEqual([]);
    expect(linkedNotes('[[Write report]]')).toEqual(['[[Write report]]']);
    expect(linkedNotes(['[[Write report]]', '[[Book flights]]'])).toEqual([
      '[[Write report]]',
      '[[Book flights]]',
    ]);
  });
});

describe('holdsOnlyText', () => {
  it('holds a link, a list of them, or nothing yet', () => {
    expect(holdsOnlyText(undefined)).toBe(true);
    expect(holdsOnlyText('[[Write report]]')).toBe(true);
    expect(holdsOnlyText(['[[Write report]]', null, 'Book flights'])).toBe(true);
  });

  it.each([
    ['a map', { report: '[[Write report]]' }],
    ['a list holding a map', ['[[Write report]]', { link: '[[Book flights]]' }]],
    ['a nested list', [['[[Write report]]']]],
    ['a number', 7],
  ])('does not hold %s, which adding a link would turn into words', (_shape, value) => {
    expect(holdsOnlyText(value)).toBe(false);
  });
});

describe('withLink', () => {
  it('adds to the list a several-notes relation holds', () => {
    expect(withLink({ value: '[[Write report]]', link: '[[Book flights]]', many: true })).toEqual([
      '[[Write report]]',
      '[[Book flights]]',
    ]);
    expect(withLink({ value: null, link: '[[Book flights]]', many: true })).toEqual([
      '[[Book flights]]',
    ]);
  });

  it('never links the same note twice', () => {
    expect(withLink({ value: ['[[Write report]]'], link: '[[Write report]]', many: true })).toEqual(
      ['[[Write report]]'],
    );
  });

  it('replaces the one note a single relation holds', () => {
    expect(withLink({ value: '[[Write report]]', link: '[[Book flights]]', many: false })).toBe(
      '[[Book flights]]',
    );
  });
});

describe('withoutLink', () => {
  it('takes one note out and keeps the rest in order', () => {
    expect(
      withoutLink(['[[Write report]]', '[[Book flights]]', '[[Pay rent]]'], '[[Book flights]]'),
    ).toEqual(['[[Write report]]', '[[Pay rent]]']);
  });

  it('clears the property when the last note goes', () => {
    expect(withoutLink(['[[Write report]]'], '[[Write report]]')).toBeNull();
    expect(withoutLink('[[Write report]]', '[[Write report]]')).toBeNull();
  });
});
