import { describe, expect, it } from 'vitest';
import { noteNames } from '../types/relation-names.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  countOf,
  groupName,
  legendName,
  nounOf,
  percentOf,
  pluralOf,
  withoutValue,
} from './wording.ts';

describe('withoutValue', () => {
  it('names the property as a noun with its article', () => {
    expect(withoutValue(7, 'phase')).toBe('7 without a phase');
    expect(withoutValue(2, 'estimate')).toBe('2 without an estimate');
    expect(withoutValue(1, 'blocked_by')).toBe('1 without a blocked by');
  });

  it('chooses the article by sound, not by the first letter', () => {
    expect(withoutValue(3, 'unit')).toBe('3 without a unit');
    expect(withoutValue(3, 'user')).toBe('3 without a user');
    expect(withoutValue(3, 'hour')).toBe('3 without an hour');
    expect(withoutValue(3, 'owner')).toBe('3 without an owner');
    expect(withoutValue(3, 'unimportant_flag')).toBe('3 without an unimportant flag');
  });
});

describe('nounOf', () => {
  it('reads a key as a lower-case noun', () => {
    expect(nounOf('dueDate')).toBe('due date');
  });
});

describe('percentOf', () => {
  it('rounds a part of the whole to a whole percent', () => {
    expect(percentOf(166, 177)).toBe(94);
    expect(percentOf(1, 3)).toBe(33);
  });

  it('says 100% only when the part is the whole', () => {
    expect(percentOf(199, 200)).toBe(99);
    expect(percentOf(200, 200)).toBe(100);
  });

  it('says 0% only when the part is nothing', () => {
    expect(percentOf(1, 400)).toBe(1);
    expect(percentOf(0, 400)).toBe(0);
  });

  it('has no share of an empty whole', () => {
    expect(percentOf(3, 0)).toBe(0);
    expect(percentOf(Number.NaN, 5)).toBe(0);
  });
});

describe('pluralOf', () => {
  it('makes the regular plurals', () => {
    expect(pluralOf('task')).toBe('tasks');
    expect(pluralOf('phase')).toBe('phases');
    expect(pluralOf('status')).toBe('statuses');
    expect(pluralOf('box')).toBe('boxes');
    expect(pluralOf('company')).toBe('companies');
    expect(pluralOf('day')).toBe('days');
  });

  it('leaves a blank noun blank', () => {
    expect(pluralOf('  ')).toBe('');
  });
});

describe('countOf', () => {
  it('uses the singular for exactly one', () => {
    expect(countOf(1, 'task')).toBe('1 task');
    expect(countOf(0, 'task')).toBe('0 tasks');
    expect(countOf(12, 'task')).toBe('12 tasks');
  });
});

describe('a group named for what it counts', () => {
  const names = noteNames([{ path: 'P-01.md' as VaultPath, title: 'Atlas' }]);

  it("names a relation's group by the note it links, never the link", () => {
    expect(groupName('[[P-01]]', names)).toBe('Atlas');
    expect(groupName('[[Gone]]', names)).toBe('Gone');
    expect(groupName('doing', names)).toBe('doing');
  });

  it('humanises a legend entry that is a value, but not one that is a note', () => {
    expect(legendName('in_review', names)).toBe('In review');
    expect(legendName('[[P-01]]', names)).toBe('Atlas');
    expect(legendName('', names)).toBe('No value');
  });
});
