import { describe, expect, it } from 'vitest';
import type { ObjectType, PropertyDef } from '../types/property-def.ts';
import { repeatKeysOf } from './repeating-task.ts';

/** #260: what a board reads of a repeating task, to draw where finishing it puts it. */
const property = (key: string): PropertyDef => ({
  key,
  kind: 'text',
  label: key,
  required: false,
  options: [],
  target: null,
  many: false,
});

const typeWith = (...keys: string[]): ObjectType => ({
  name: 'task',
  label: 'Task',
  properties: keys.map(property),
});

describe('repeatKeysOf', () => {
  it('is the recurrence and the due date of a type that declares both', () => {
    expect(repeatKeysOf(typeWith('status', 'due', 'recurrence'))).toEqual(['recurrence', 'due']);
  });

  it('is nothing for a type that cannot repeat, or no type', () => {
    expect(repeatKeysOf(typeWith('status', 'due'))).toEqual([]);
    expect(repeatKeysOf(typeWith('status', 'recurrence'))).toEqual([]);
    expect(repeatKeysOf(null)).toEqual([]);
  });
});
