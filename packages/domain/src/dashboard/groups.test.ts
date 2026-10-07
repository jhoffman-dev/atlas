import { describe, expect, it } from 'vitest';
import {
  compareKeys,
  gatherTail,
  highlightedKey,
  isKeyedSeries,
  orderForAxis,
  parseHighlight,
  rankGroups,
  sharesOf,
  sortByKey,
  splitUnset,
  withEmptyOptions,
  type GroupCount,
} from './groups.ts';

const groups = (...pairs: [string, number][]): GroupCount[] =>
  pairs.map(([label, count]) => ({ label, count }));
const labels = (list: readonly GroupCount[]): string[] => list.map((group) => group.label);

describe('compareKeys', () => {
  it('orders numeric keys as numbers, not as text', () => {
    expect(['10', '2', '0', '11', '1'].sort(compareKeys)).toEqual(['0', '1', '2', '10', '11']);
  });

  it('orders decimals and negatives as numbers', () => {
    expect(['1.5', '-2', '1'].sort(compareKeys)).toEqual(['-2', '1', '1.5']);
  });

  it('orders words by their text, comparing any digits in them as numbers', () => {
    expect(['phase 10', 'phase 9', 'alpha'].sort(compareKeys)).toEqual([
      'alpha',
      'phase 9',
      'phase 10',
    ]);
  });

  it('puts numbers before words', () => {
    expect(['b', '3', 'a'].sort(compareKeys)).toEqual(['3', 'a', 'b']);
  });
});

describe('sortByKey and orderForAxis', () => {
  it('sorts a series by key without touching the input', () => {
    const input = groups(['10', 1], ['2', 5], ['1', 3]);
    expect(labels(sortByKey(input))).toEqual(['1', '2', '10']);
    expect(labels(input)).toEqual(['10', '2', '1']);
  });

  it('puts a numeric series on the axis in key order', () => {
    expect(labels(orderForAxis(groups(['13', 33], ['12', 29], ['0', 5])))).toEqual([
      '0',
      '12',
      '13',
    ]);
  });

  it('leaves words in the order they came, which is biggest first', () => {
    expect(labels(orderForAxis(groups(['done', 9], ['backlog', 3], ['doing', 1])))).toEqual([
      'done',
      'backlog',
      'doing',
    ]);
  });

  it('is a series only when every key is a number', () => {
    expect(isKeyedSeries(groups(['1', 1], ['2', 1]))).toBe(true);
    expect(isKeyedSeries(groups(['1', 1], ['two', 1]))).toBe(false);
    expect(isKeyedSeries([])).toBe(false);
  });
});

describe('splitUnset', () => {
  it('takes the notes with no value off the axis and counts them', () => {
    const { groups: kept, unset } = splitUnset(groups(['1', 4], ['', 7], ['2', 3]));
    expect(labels(kept)).toEqual(['1', '2']);
    expect(unset).toBe(7);
  });

  it('counts nothing unset when every note has a value', () => {
    expect(splitUnset(groups(['1', 4])).unset).toBe(0);
  });
});

describe('parseHighlight', () => {
  it('reads the named rules', () => {
    expect(parseHighlight('last')).toEqual({ kind: 'last' });
    expect(parseHighlight(' max ')).toEqual({ kind: 'max' });
    expect(parseHighlight('none')).toEqual({ kind: 'none' });
  });

  it('reads anything else as the key to call out, numbers included', () => {
    expect(parseHighlight('review')).toEqual({ kind: 'key', key: 'review' });
    expect(parseHighlight(15)).toEqual({ kind: 'key', key: '15' });
  });

  it('reads blank, missing and structured values as the default', () => {
    expect(parseHighlight('')).toBeNull();
    expect(parseHighlight(undefined)).toBeNull();
    expect(parseHighlight({ key: 'x' })).toBeNull();
  });
});

describe('highlightedKey', () => {
  const phases = groups(['13', 33], ['2', 6], ['10', 7]);
  const statuses = groups(['backlog', 3], ['done', 9], ['doing', 1]);

  it('calls out the last key of a series by default — 10, not 2', () => {
    expect(highlightedKey(phases, null)).toBe('13');
    expect(highlightedKey(groups(['2', 6], ['10', 1]), null)).toBe('10');
  });

  it('calls out the largest group of anything that is not a series', () => {
    expect(highlightedKey(statuses, null)).toBe('done');
  });

  it('follows a declared rule', () => {
    expect(highlightedKey(groups(['2', 60], ['10', 1]), { kind: 'max' })).toBe('2');
    expect(highlightedKey(groups(['b', 9], ['c', 1], ['a', 4]), { kind: 'last' })).toBe('c');
    expect(highlightedKey(phases, { kind: 'none' })).toBeNull();
    expect(highlightedKey(phases, { kind: 'key', key: '2' })).toBe('2');
  });

  it('calls out nothing when the declared key is not there', () => {
    expect(highlightedKey(phases, { kind: 'key', key: '99' })).toBeNull();
  });

  it('takes the first of two equal largest groups', () => {
    expect(highlightedKey(groups(['a', 2], ['b', 2]), { kind: 'max' })).toBe('a');
  });

  it('calls out nothing in an empty chart', () => {
    expect(highlightedKey([], null)).toBeNull();
    expect(highlightedKey([], { kind: 'max' })).toBeNull();
  });
});

describe('sharesOf', () => {
  it('gives whole percentages that add up to exactly 100', () => {
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([166, 11, 0])).toEqual([94, 6, 0]);
  });

  it('hands the left-over points to the shares that lost most in rounding', () => {
    // 12.5 / 37.5 / 50: the two halves tie on remainder and the first wins.
    expect(sharesOf([1, 3, 4])).toEqual([13, 37, 50]);
    // 14.29 / 28.57 / 57.14: floors sum to 98, and .57 twice beats .29.
    expect(sharesOf([1, 2, 4])).toEqual([14, 29, 57]);
  });

  it('gives nothing a share when nothing was counted', () => {
    expect(sharesOf([0, 0])).toEqual([0, 0]);
    expect(sharesOf([])).toEqual([]);
  });

  it('treats a broken count as nothing', () => {
    expect(sharesOf([Number.NaN, -3, 5])).toEqual([0, 0, 100]);
  });
});

describe('rankGroups', () => {
  const phases = groups(['13', 33], ['12', 29], ['14', 22], ['15', 12], ['0', 5], ['', 7]);

  it('keeps the largest few, largest first, sized against the largest', () => {
    const { rows } = rankGroups(phases, 2);
    expect(rows).toEqual([
      { label: '13', count: 33, fraction: 1 },
      { label: '12', count: 29, fraction: 29 / 33 },
    ]);
  });

  it('says how much of the whole the shown rows hold', () => {
    const { shown, total } = rankGroups(phases, 4);
    expect(shown).toBe(96);
    expect(total).toBe(108);
  });

  it('breaks a tie in key order', () => {
    expect(labels(rankGroups(groups(['10', 4], ['9', 4]), 2).rows)).toEqual(['9', '10']);
  });

  it('leaves out groups nobody is in', () => {
    expect(labels(rankGroups(groups(['a', 3], ['b', 0]), 5).rows)).toEqual(['a']);
  });

  it('ranks nothing when asked for no rows', () => {
    expect(rankGroups(phases, 0).rows).toEqual([]);
    expect(rankGroups(phases, -1).rows).toEqual([]);
  });
});

describe('withEmptyOptions', () => {
  it('adds the declared options no note has, as zero, after the counted ones', () => {
    const filled = withEmptyOptions(groups(['done', 9], ['backlog', 3]), [
      'backlog',
      'next',
      'doing',
      'done',
    ]);
    expect(filled).toEqual(groups(['done', 9], ['backlog', 3], ['next', 0], ['doing', 0]));
  });

  it('adds nothing when there are no declared options', () => {
    expect(withEmptyOptions(groups(['a', 1]), [])).toEqual(groups(['a', 1]));
  });
});

describe('gatherTail', () => {
  it('gathers everything past the first few into Other, keeping its count', () => {
    const gathered = gatherTail(groups(['a', 5], ['b', 4], ['c', 2], ['d', 1]), 2);
    expect(gathered).toEqual(groups(['a', 5], ['b', 4], ['Other', 3]));
  });

  it('leaves a short list alone, zero rows included', () => {
    const short = groups(['a', 5], ['b', 0]);
    expect(gatherTail(short, 2)).toEqual(short);
  });

  it('names the tail apart from a real group called Other', () => {
    const gathered = gatherTail(groups(['Other', 5], ['b', 4], ['c', 2], ['d', 1]), 2);
    expect(gathered).toEqual(groups(['Other', 5], ['b', 4], ['Other (2 more)', 3]));
  });

  it('names the tail apart from a reserved option, and from a group that took the second name', () => {
    const counted = groups(['a', 5], ['Other (2 more)', 4], ['c', 2], ['d', 1]);
    expect(gatherTail(counted, 2, ['Other']).at(-1)).toEqual({
      label: 'Other (2 more) 2',
      count: 3,
    });
  });
});

describe('withEmptyOptions, after a tail was gathered', () => {
  it('does not list an option as empty when its notes were gathered into Other', () => {
    const counted = groups(['a', 5], ['b', 4], ['c', 2]);
    const filled = withEmptyOptions(gatherTail(counted, 2), ['a', 'b', 'c', 'd'], counted);
    expect(filled).toEqual(groups(['a', 5], ['b', 4], ['Other', 2], ['d', 0]));
  });
});

/** A small seeded generator, so the property checks below are the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sharesOf, over many seeded inputs', () => {
  const random = seeded(16);
  const cases = Array.from({ length: 2000 }, () =>
    Array.from({ length: 1 + Math.floor(random() * 12) }, () =>
      random() < 0.2 ? 0 : Math.floor(random() * 1000),
    ),
  );

  it('always adds up to exactly 100 when anything was counted', () => {
    const wrong = cases
      .filter((counts) => counts.some((count) => count > 0))
      .filter((counts) => sharesOf(counts).reduce((sum, share) => sum + share, 0) !== 100);
    expect(wrong).toEqual([]);
  });

  it('never gives a share to a group with nothing in it', () => {
    const wrong = cases.filter((counts) =>
      sharesOf(counts).some((share, index) => counts[index] === 0 && share !== 0),
    );
    expect(wrong).toEqual([]);
  });

  it('rounds each share to one side of its exact value', () => {
    const wrong = cases.filter((counts) => {
      const total = counts.reduce((sum, count) => sum + count, 0);
      if (total === 0) return false;
      return sharesOf(counts).some((share, index) => {
        const exact = ((counts[index] ?? 0) / total) * 100;
        return share < Math.floor(exact - 1e-9) || share > Math.ceil(exact + 1e-9);
      });
    });
    expect(wrong).toEqual([]);
  });
});

describe('compareKeys, as a sort order', () => {
  const keys = [
    '',
    ' ',
    '-1',
    '-0',
    '0',
    '1.5',
    '2',
    '10',
    '1e3',
    'Infinity',
    'NaN',
    'a2',
    'a10',
    'B',
    'b',
    'é',
    'phase 2',
  ];
  const sign = (value: number) => Math.sign(value) || 0;

  it('is antisymmetric: a before b means b after a', () => {
    const wrong = keys.flatMap((left) =>
      keys
        .filter((right) => sign(compareKeys(left, right)) !== -sign(compareKeys(right, left)))
        .map((right) => [left, right]),
    );
    expect(wrong).toEqual([]);
  });

  it('is transitive, so a sort never depends on the order the keys came in', () => {
    const wrong: string[][] = [];
    for (const a of keys)
      for (const b of keys)
        for (const c of keys)
          if (compareKeys(a, b) <= 0 && compareKeys(b, c) <= 0 && compareKeys(a, c) > 0)
            wrong.push([a, b, c]);
    expect(wrong).toEqual([]);
  });
});

describe('rankGroups at its bounds', () => {
  const counted = groups(['a', 3], ['b', 2], ['c', 1]);

  it('shows no rows for a top of zero, and still knows the total', () => {
    expect(rankGroups(counted, 0)).toEqual({ rows: [], shown: 0, total: 6 });
  });

  it('shows every row when the top is more than there are', () => {
    expect(rankGroups(counted, 1000).rows.map((row) => row.label)).toEqual(['a', 'b', 'c']);
  });
});
