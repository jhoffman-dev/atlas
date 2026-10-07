import { describe, expect, it } from 'vitest';
import { calloutLabel, formatCalloutMarker, parseCalloutMarker } from './callout.ts';

describe('parseCalloutMarker', () => {
  it('reads a bare callout', () => {
    expect(parseCalloutMarker('[!note]')).toEqual({ kind: 'note', title: null, fold: null });
  });

  it('reads a title', () => {
    expect(parseCalloutMarker('[!warning] Be careful')).toEqual({
      kind: 'warning',
      title: 'Be careful',
      fold: null,
    });
  });

  it.each([
    ['[!note]+', '+'],
    ['[!note]-', '-'],
  ])('reads the fold marker in %j', (line, fold) => {
    expect(parseCalloutMarker(line)?.fold).toBe(fold);
  });

  it('reads a fold marker and a title together', () => {
    expect(parseCalloutMarker('[!tip]- Folded tip')).toEqual({
      kind: 'tip',
      title: 'Folded tip',
      fold: '-',
    });
  });

  it('lowercases the kind so styling is predictable', () => {
    expect(parseCalloutMarker('[!NOTE]')?.kind).toBe('note');
  });

  it('accepts a hyphenated kind', () => {
    expect(parseCalloutMarker('[!my-kind]')?.kind).toBe('my-kind');
  });

  it.each([
    ['plain text', 'not a callout'],
    ['a wiki link', '[[Note]]'],
    ['an empty marker', '[!]'],
    ['a marker starting with a digit', '[!1note]'],
    ['an unclosed marker', '[!note'],
    ['a marker that is not first', 'text [!note]'],
  ])('returns null for %s', (_label, line) => {
    expect(parseCalloutMarker(line)).toBeNull();
  });
});

describe('formatCalloutMarker', () => {
  it.each(['[!note]', '[!warning] Be careful', '[!tip]-', '[!tip]- Folded tip'])(
    'writes %j back unchanged',
    (line) => {
      const marker = parseCalloutMarker(line);
      expect(marker).not.toBeNull();
      if (marker === null) return;
      expect(formatCalloutMarker(marker)).toBe(line);
    },
  );
});

describe('calloutLabel', () => {
  it('uses the title when there is one', () => {
    expect(calloutLabel({ kind: 'note', title: 'Read this', fold: null })).toBe('Read this');
  });

  it('falls back to the capitalised kind', () => {
    expect(calloutLabel({ kind: 'warning', title: null, fold: null })).toBe('Warning');
  });
});
