import { describe, expect, it } from 'vitest';
import { parseObjectType } from './property-def.ts';
import { applyTypeEdit, manyOf, TypeEditError } from './type-edit.ts';

const MEETING = parseObjectType({
  name: 'meeting',
  label: 'Meeting',
  properties: {
    stage: { kind: 'select', options: ['draft', 'final'] },
    topics: { kind: 'multiSelect', options: ['plan'] },
    people: { kind: 'relation', target: 'person' },
    venue: { kind: 'relation', target: 'venue' },
    date: 'date',
  },
});
const prop = (key: string) => MEETING.properties.find((each) => each.key === key)!;
const after = (key: string, many: boolean) =>
  applyTypeEdit(
    MEETING,
    { kind: 'setMany', key, many },
    { types: ['person'] },
  ).type.properties.find((each) => each.key === key)!;

/** "Allow many" (slice 12): several values where a kind can hold them, as the type file already says it. */
describe('allowing many', () => {
  it('reads whether a property holds several values, and null for a kind of one', () => {
    expect(manyOf(prop('stage'))).toBe(false);
    expect(manyOf(prop('topics'))).toBe(true);
    expect(manyOf(prop('people'))).toBe(false);
    expect(manyOf(prop('date'))).toBeNull();
  });

  it('turns a select into a multi-select, and back, keeping its options', () => {
    expect(after('stage', true)).toMatchObject({
      kind: 'multiSelect',
      options: ['draft', 'final'],
    });
    expect(after('topics', false)).toMatchObject({ kind: 'select', options: ['plan'] });
  });

  it('lets a relation hold several notes, keeping what it points at', () => {
    expect(after('people', true)).toMatchObject({ kind: 'relation', target: 'person', many: true });
  });

  it('does not ask a relation’s target to exist: a type file may point ahead of its types', () => {
    expect(after('venue', true)).toMatchObject({ target: 'venue', many: true });
  });

  it('refuses a kind that holds one value only', () => {
    expect(() => after('date', true)).toThrow(TypeEditError);
  });
});
