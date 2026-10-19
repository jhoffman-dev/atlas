import { describe, expect, it } from 'vitest';
import { countedWork, countedWorkAsync, patternsMadeIn } from './counted-work.ts';

const { exec } = RegExp.prototype;
const { indexOf, slice } = String.prototype;
const { filter, sort } = Array.prototype;
const { get } = Map.prototype;

describe('countedWork', () => {
  it('counts what each built-in read', () => {
    const text = 'abcdefghij';
    expect(countedWork(() => /j/.exec(text))).toBe(10);
    expect(countedWork(() => /z/g.exec(text))).toBe(10);
    expect(countedWork(() => text.indexOf('c'))).toBe(3);
    expect(countedWork(() => text.indexOf('c', 5))).toBe(5);
    expect(countedWork(() => text.includes('z'))).toBe(10);
    expect(countedWork(() => text.slice(2, 5))).toBe(3);
    expect(countedWork(() => text.split(''))).toBe(10);
    expect(countedWork(() => text.startsWith('abc'))).toBe(3);
    expect(countedWork(() => ['ab', 'cd'].join('-'))).toBe(5);
    expect(countedWork(() => [1, 2, 3].includes(2))).toBe(2);
    expect(countedWork(() => [1, 2, 3, 4].filter(Boolean))).toBe(4);
    expect(countedWork(() => new Map([[1, 1]]).get(1))).toBe(2);
    expect(countedWork(() => new Set([1]).has(1))).toBe(2);
    expect(countedWork(() => ['b', 'a'].sort())).toBe(2);
    expect(countedWork(() => [2, 1].sort((left, right) => left - right))).toBe(1);
  });

  it('tells a pass per item over the rest from one pass', () => {
    const items = (count: number) => Array.from({ length: count }, (_, at) => at);
    const once = (count: number) => () => items(count).filter((item) => item % 2 === 0);
    const each = (count: number) => () => {
      const all = items(count);
      return all.filter((item) => all.includes(item + 1));
    };
    expect(countedWork(once(4000)) / countedWork(once(1000))).toBe(4);
    expect(countedWork(each(4000)) / countedWork(each(1000))).toBeGreaterThan(15);
  });

  it('counts a regex split and a sticky lexer as linear, and a global replace once over the text', () => {
    // A split runs a sticky copy of its pattern at each position; a failed try reads one character.
    const splitting = (count: number) => () => 'ab,'.repeat(count).split(/,/);
    const lexing = (count: number) => () => {
      const text = 'ab 12 '.repeat(count);
      const token = /[a-z]+|\d+|\s+/y;
      while (token.lastIndex < text.length && token.exec(text) !== null);
    };
    const replacing = (count: number) => () => 'ab,'.repeat(count).replace(/,/g, ';');
    for (const work of [splitting, lexing, replacing]) {
      expect(countedWork(work(4000)) / countedWork(work(1000))).toBeCloseTo(4, 1);
    }
    expect(countedWork(() => /c/y.exec('abc'))).toBe(1);
    expect(countedWork(() => 'a,b'.replace(/,/g, ';'))).toBe(3);
  });

  it('puts every built-in back, even when the work throws', () => {
    expect(() =>
      countedWork(() => {
        throw new Error('the work failed');
      }),
    ).toThrow('the work failed');
    expect(RegExp.prototype.exec).toBe(exec);
    expect(String.prototype.indexOf).toBe(indexOf);
    expect(String.prototype.slice).toBe(slice);
    expect(Array.prototype.filter).toBe(filter);
    expect(Array.prototype.sort).toBe(sort);
    expect(Map.prototype.get).toBe(get);
  });
});

describe('countedWorkAsync', () => {
  it('counts the work its awaits lead to, then puts the built-ins back', async () => {
    const work = await countedWorkAsync(async () => {
      const text = await Promise.resolve('abcdefghij');
      return text.indexOf('j');
    });
    expect(work).toBe(10);
    expect(String.prototype.indexOf).toBe(indexOf);
    await expect(countedWorkAsync(() => Promise.reject(new Error('refused')))).rejects.toThrow(
      'refused',
    );
    expect(String.prototype.indexOf).toBe(indexOf);
  });
});

describe('patternsMadeIn', () => {
  it('lists each pattern made, with `new` or without, and leaves RegExp as it was', () => {
    const Original = RegExp;
    const made = patternsMadeIn(() => {
      new RegExp('a+b', 'g');
      RegExp(/c|d/);
      expect(/literal/.test('literal')).toBe(true);
      expect(new RegExp('x') instanceof Original).toBe(true);
    });
    expect(made).toEqual(['a+b', 'c|d', 'x']);
    expect(globalThis.RegExp).toBe(Original);
  });
});
