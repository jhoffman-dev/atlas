import { describe, expect, it } from 'vitest';
import {
  HASHED_HUES,
  heldOptions,
  hueOf,
  isOptionColor,
  isPillHue,
  OPTION_COLORS,
  optionColor,
  optionColorsByKey,
  optionColorsOf,
  PILL_HUES,
  relationHue,
  STATUS_TONES,
  statusTone,
  tagHue,
} from './index.ts';

describe('the pill palette', () => {
  it('holds the nine Notion-like hues, in the order a picker lists them', () => {
    expect(PILL_HUES).toEqual([
      'gray',
      'brown',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'red',
    ]);
  });

  it('hashes into every hue but gray, which reads as no colour at all', () => {
    expect(HASHED_HUES).toEqual(PILL_HUES.filter((hue) => hue !== 'gray'));
  });

  it('offers an option the status tones and the hues, each once', () => {
    expect(OPTION_COLORS).toEqual([...STATUS_TONES, ...PILL_HUES]);
    expect(new Set(OPTION_COLORS).size).toBe(OPTION_COLORS.length);
  });

  it('knows a colour from anything else', () => {
    expect(isOptionColor('done')).toBe(true);
    expect(isOptionColor('purple')).toBe(true);
    expect(isOptionColor('teal')).toBe(false);
    expect(isOptionColor(3)).toBe(false);
    expect(isPillHue('purple')).toBe(true);
    expect(isPillHue('done')).toBe(false);
  });
});

describe('hueOf', () => {
  it('gives the same name the same hue every time', () => {
    const first = hueOf('Larkspur Payroll');
    for (let time = 0; time < 5; time += 1) expect(hueOf('Larkspur Payroll')).toBe(first);
  });

  it('pins the hash, so a value keeps its colour from release to release', () => {
    // A change to the hash would recolour every pill in every vault, so it
    // fails here rather than quietly.
    expect(
      ['Interview', '1on1', 'Larkspur Payroll', 'Mara Quill', 'Tobias Fenn'].map(hueOf),
    ).toEqual(['pink', 'red', 'purple', 'purple', 'pink']);
  });

  it('reads a name the way a person does: case and outer spaces aside', () => {
    expect(hueOf('  Mara Quill ')).toBe(hueOf('mara quill'));
    expect(hueOf('MARA QUILL')).toBe(hueOf('mara quill'));
  });

  it('spreads many names across all eight hashed hues, none crowding the rest', () => {
    const names = Array.from({ length: 800 }, (_, at) => `option ${String(at)}`);
    const tally = new Map<string, number>();
    for (const name of names) tally.set(hueOf(name), (tally.get(hueOf(name)) ?? 0) + 1);
    expect([...tally.keys()].sort()).toEqual([...HASHED_HUES].sort());
    // A fair share is 100 each; a hash this skewed would paint a table one colour.
    for (const count of tally.values()) {
      expect(count).toBeGreaterThan(60);
      expect(count).toBeLessThan(140);
    }
  });

  it('never hashes to gray', () => {
    const hues = Array.from({ length: 500 }, (_, at) => hueOf(`n${String(at)}`));
    expect(hues).not.toContain('gray');
  });
});

describe('optionColor', () => {
  const kind = { colors: { Interview: 'blue', Archive: 'done' } } as const;

  it('takes the colour the type file chose, by palette name or by tone', () => {
    expect(optionColor(kind, 'Interview')).toBe('blue');
    expect(optionColor(kind, 'Archive')).toBe('done');
  });

  it('draws the status property’s options by their tone, as it always has', () => {
    expect(optionColor({ key: 'status' }, 'doing')).toBe('doing');
    expect(optionColor({ key: 'status' }, 'next-action')).toBe('next');
    expect(optionColor({ key: 'Status' }, 'Complete')).toBe('done');
  });

  it('gives any other property’s option a hue, even one spelled like a status', () => {
    // A meeting's Kind "Review" is not a review status: no dot, no status tone.
    expect(optionColor({ key: 'kind' }, 'Review')).toBe(hueOf('Review'));
    expect(optionColor({ key: 'stage' }, 'done')).toBe(hueOf('done'));
    expect(optionColor(null, 'doing')).toBe(hueOf('doing'));
  });

  it('still takes a tone the type chose for another property’s option', () => {
    expect(optionColor({ key: 'kind', colors: { Review: 'review' } }, 'Review')).toBe('review');
  });

  it('gives any other option a stable hue from its value', () => {
    expect(optionColor(null, '1on1')).toBe(hueOf('1on1'));
    expect(optionColor(kind, '1on1')).toBe(hueOf('1on1'));
  });

  it('draws no value in the quiet backlog grey, not a guessed hue', () => {
    expect(optionColor(null, '')).toBe('backlog');
    expect(optionColor(null, '   ')).toBe('backlog');
  });
});

describe('relationHue', () => {
  it('colours a linked note by its name', () => {
    expect(relationHue({ key: 'Larkspur Payroll' })).toBe(hueOf('Larkspur Payroll'));
  });

  it('takes the note’s own color property when it names a hue', () => {
    expect(relationHue({ key: 'Larkspur Payroll', color: 'Green' })).toBe('green');
    expect(relationHue({ key: 'Larkspur Payroll', color: 'gray' })).toBe('gray');
  });

  it('ignores a color property that is not a hue', () => {
    expect(relationHue({ key: 'Mara Quill', color: 'teal' })).toBe(hueOf('Mara Quill'));
    expect(relationHue({ key: 'Mara Quill', color: 7 })).toBe(hueOf('Mara Quill'));
  });
});

describe('tagHue', () => {
  it('gives a tag the same hue with or without its #', () => {
    expect(tagHue('#payroll')).toBe(tagHue('payroll'));
    expect(tagHue('Payroll')).toBe(hueOf('payroll'));
  });
});

describe('heldOptions', () => {
  it('reads a list, or the cell a view joined it into, as its options', () => {
    expect(heldOptions(['Interview', ' 1on1 '])).toEqual(['Interview', '1on1']);
    expect(heldOptions('Interview, 1on1')).toEqual(['Interview', '1on1']);
  });

  it('holds nothing for no value or a blank one', () => {
    expect(heldOptions(null)).toEqual([]);
    expect(heldOptions(undefined)).toEqual([]);
    expect(heldOptions(' , ')).toEqual([]);
  });
});

describe('optionColorsByKey', () => {
  it('keeps each property’s own colours, by key, and leaves out those with none', () => {
    const kind = { key: 'kind', colors: { Interview: 'blue' } } as const;
    const byKey = optionColorsByKey([kind, { key: 'provider' }]);
    expect(byKey).toEqual({ kind: { Interview: 'blue' } });
    expect(byKey['kind']).toBe(kind.colors);
  });
});

describe('values that are also names on every object', () => {
  const NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

  it.each(NAMES)(
    'colours an option called %s by its value, not by what objects inherit',
    (name) => {
      expect(optionColor({ colors: {} }, name)).toBe(hueOf(name));
      expect(optionColor({ colors: { other: 'red' } }, name)).toBe(hueOf(name));
      expect(optionColor(null, name)).toBe(hueOf(name));
    },
  );

  it.each(NAMES)('reads no colours for a property called %s', (name) => {
    expect(optionColorsOf({ kind: { a: 'red' } }, name)).toBeUndefined();
    expect(optionColorsOf({ kind: { a: 'red' } }, 'kind')).toEqual({ a: 'red' });
  });

  it.each(NAMES)('draws a status called %s in the quiet grey', (name) => {
    expect(statusTone(name)).toBe('backlog');
  });
});

describe('the hash cache', () => {
  it('gives every name the same hue after the cache has been emptied', () => {
    const watched = ['Larkspur Payroll', 'Interview', 'mara quill'];
    const first = watched.map(hueOf);
    // More names than the cache holds, so it empties at least once.
    for (let at = 0; at < 5000; at += 1) hueOf(`filler ${String(at)}`);
    expect(watched.map(hueOf)).toEqual(first);
    expect(first).toEqual(['purple', 'pink', 'purple']);
  });
});
