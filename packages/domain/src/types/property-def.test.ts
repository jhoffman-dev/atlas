import { describe, expect, it } from 'vitest';
import { InvalidTypeError, parseObjectType } from './property-def.ts';

describe('parseObjectType', () => {
  it('reads a name and label', () => {
    const type = parseObjectType({ name: 'company', label: 'Company' });
    expect(type).toMatchObject({ name: 'company', label: 'Company' });
  });

  it('falls back to the name when there is no label', () => {
    expect(parseObjectType({ name: 'company' }).label).toBe('company');
  });

  it('labels a property by its declared label, else by its key read as words', () => {
    const type = parseObjectType({
      name: 'task',
      properties: { blocked_by: 'text', due: { kind: 'date', label: 'Due on' } },
    });
    expect(type.properties.map((p) => p.label)).toEqual(['Blocked by', 'Due on']);
  });

  it.each([{}, { name: '' }, { name: '   ' }])('refuses a type with no name (%j)', (input) => {
    expect(() => parseObjectType(input)).toThrow(InvalidTypeError);
  });

  it('reads properties with their kinds', () => {
    const type = parseObjectType({
      name: 'company',
      properties: { arr: { kind: 'number' }, stage: { kind: 'select', options: ['seed', 'a'] } },
    });
    expect(type.properties.map((p) => [p.key, p.kind])).toEqual([
      ['arr', 'number'],
      ['stage', 'select'],
    ]);
    expect(type.properties[1]?.options).toEqual(['seed', 'a']);
  });

  it('reads an option listed twice once, where it first appears', () => {
    // Every consumer keys by option — board columns, a select's <option>s.
    const type = parseObjectType({
      name: 'task',
      properties: { status: { kind: 'select', options: ['todo', 'doing', 'todo'] } },
    });
    expect(type.properties[0]?.options).toEqual(['todo', 'doing']);
  });

  it('accepts the shorthand form', () => {
    const type = parseObjectType({ name: 'company', properties: { founded: 'date' } });
    expect(type.properties[0]).toMatchObject({ key: 'founded', kind: 'date' });
  });

  it('defaults a property with no kind to text', () => {
    const type = parseObjectType({ name: 'company', properties: { note: {} } });
    expect(type.properties[0]?.kind).toBe('text');
  });

  it('reads a relation and what it points at', () => {
    const type = parseObjectType({
      name: 'company',
      properties: { ceo: { kind: 'relation', target: 'person' } },
    });
    expect(type.properties[0]).toMatchObject({ kind: 'relation', target: 'person', many: false });
  });

  it('reads a relation that holds several notes', () => {
    const type = parseObjectType({
      name: 'company',
      properties: { employees: { kind: 'relation', target: 'person', many: true } },
    });
    expect(type.properties[0]?.many).toBe(true);
  });

  it('drops a relation with nothing to point at, since it could offer nothing', () => {
    const type = parseObjectType({
      name: 'company',
      properties: { ceo: { kind: 'relation' }, name: 'text' },
    });
    expect(type.properties.map((p) => p.key)).toEqual(['name']);
  });

  it('drops a property with an unknown kind rather than failing the type', () => {
    const type = parseObjectType({
      name: 'company',
      properties: { odd: { kind: 'hologram' }, name: 'text' },
    });
    expect(type.properties.map((p) => p.key)).toEqual(['name']);
  });

  it('treats multiSelect as holding several values', () => {
    const type = parseObjectType({ name: 'x', properties: { tags: { kind: 'multiSelect' } } });
    expect(type.properties[0]?.many).toBe(true);
  });

  it('marks a required property', () => {
    const type = parseObjectType({ name: 'x', properties: { name: { required: true } } });
    expect(type.properties[0]?.required).toBe(true);
  });

  it('has no properties when none are declared', () => {
    expect(parseObjectType({ name: 'x' }).properties).toEqual([]);
  });

  it('ignores a properties block that is not a map', () => {
    expect(parseObjectType({ name: 'x', properties: ['a', 'b'] }).properties).toEqual([]);
  });
});

describe('what a type chooses for how it looks', () => {
  it('reads an icon from the set a type may choose from, and ignores any other', () => {
    expect(parseObjectType({ name: 'x', icon: 'board' }).icon).toBe('board');
    expect('icon' in parseObjectType({ name: 'x', icon: 'rocket' })).toBe(false);
    expect('icon' in parseObjectType({ name: 'x', icon: 'system' })).toBe(false);
  });

  it('reads option colours on the ramp, for options the property lists', () => {
    const type = parseObjectType({
      name: 'x',
      properties: {
        status: {
          kind: 'select',
          options: ['queued', 'shipped'],
          colors: { queued: 'next', shipped: 'purple', ghost: 'done' },
        },
      },
    });
    expect(type.properties[0]?.colors).toEqual({ queued: 'next' });
  });

  it('has no colours when none are chosen, or they are not a map', () => {
    const type = parseObjectType({
      name: 'x',
      properties: { a: { kind: 'select', options: ['y'] }, b: { kind: 'select', colors: ['y'] } },
    });
    expect(type.properties.map((property) => property.colors)).toEqual([undefined, undefined]);
  });
});
