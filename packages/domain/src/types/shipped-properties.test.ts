import { describe, expect, it } from 'vitest';
import type { ObjectType, PropertyDef } from './property-def.ts';
import {
  NO_SHIPPED_PROPERTIES_RECORD,
  parseShippedPropertiesRecord,
  recordSettling,
  ShippedPropertiesRecordError,
  shippedPropertiesLine,
  shippedPropertiesPlan,
  shippedPropertiesRecordText,
} from './shipped-properties.ts';

const property = (key: string, kind: PropertyDef['kind'] = 'text'): PropertyDef => ({
  key,
  kind,
  label: key,
  required: false,
  options: [],
  target: null,
  many: false,
});

const type = (name: string, keys: readonly string[] = []): ObjectType => ({
  name,
  label: name,
  properties: keys.map((key) => property(key)),
});

const MEETING_KEYS = [
  'atlas_import_outcome',
  'atlas_import_error',
  'atlas_duplicate_of',
  'tasks',
  'decisions',
];

const addedKeys = (types: readonly ObjectType[], record = NO_SHIPPED_PROPERTIES_RECORD) =>
  shippedPropertiesPlan(types, record).map((change) => [
    change.before.name,
    change.added.map((added) => added.key),
  ]);

describe('shippedPropertiesPlan', () => {
  it('gives a Meeting type the keys it lacks, after its own', () => {
    const meeting = type('meeting', ['title', 'atlas_import_outcome']);
    const [change] = shippedPropertiesPlan([meeting], NO_SHIPPED_PROPERTIES_RECORD);
    expect(change?.after.properties.map((added) => added.key)).toEqual([
      'title',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
      'tasks',
      'decisions',
    ]);
  });

  it('keeps a key the type has, whatever its shape', () => {
    const tasks = { ...property('tasks', 'number'), label: 'How many' };
    const meeting: ObjectType = { name: 'meeting', label: 'Meeting', properties: [tasks] };
    const [change] = shippedPropertiesPlan([meeting], NO_SHIPPED_PROPERTIES_RECORD);
    expect(change?.after.properties[0]).toBe(tasks);
    expect(change?.added.map((added) => added.key)).not.toContain('tasks');
  });

  it('never adds a settled key again: the person took it off', () => {
    const record = { settled: { meeting: MEETING_KEYS }, added: {} };
    expect(addedKeys([type('meeting', ['title'])], record)).toEqual([]);
  });

  it('adds a key shipped since the type was settled', () => {
    const record = { settled: { meeting: MEETING_KEYS.slice(0, 3) }, added: {} };
    expect(addedKeys([type('meeting', [])], record)).toEqual([['meeting', ['tasks', 'decisions']]]);
  });

  it('matches a type by name in any case and spacing', () => {
    expect(addedKeys([type(' Daily ', ['date'])])).toEqual([[' Daily ', ['tags']]]);
  });

  it('leaves a type that lacks nothing, a type of the vault’s own, and Task', () => {
    expect(
      addedKeys([type('meeting', MEETING_KEYS), type('recipe'), type('task', ['status'])]),
    ).toEqual([]);
  });

  it('covers every built-in type Atlas ships a file for', () => {
    const names = ['project', 'area', 'resource', 'proposal', 'decision', 'daily', 'block'];
    const planned = addedKeys(names.map((name) => type(name)));
    expect(planned.map(([name]) => name)).toEqual(names);
    for (const [, keys] of planned) expect(keys).not.toHaveLength(0);
  });
});

describe('recordSettling', () => {
  it('settles every shipped key of a changed type, the ones it had too, and keeps what was added', () => {
    const changes = shippedPropertiesPlan(
      [type('Meeting', ['atlas_import_outcome'])],
      NO_SHIPPED_PROPERTIES_RECORD,
    );
    const record = recordSettling({ settled: { daily: ['date'] }, added: {} }, changes);
    expect(record).toEqual({
      settled: { daily: ['date'], meeting: MEETING_KEYS },
      added: { meeting: MEETING_KEYS.slice(1) },
    });
  });

  it('adds to what an earlier run settled and added, without repeating a key', () => {
    const earlier = { settled: { meeting: ['tasks'] }, added: { meeting: ['tasks'] } };
    const changes = shippedPropertiesPlan([type('meeting', ['tasks'])], earlier);
    const record = recordSettling(earlier, changes);
    expect(record.settled['meeting']).toEqual([
      'tasks',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
      'decisions',
    ]);
    expect(record.added['meeting']).toEqual([
      'tasks',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
      'decisions',
    ]);
  });
});

describe('the record file', () => {
  const RECORD = { settled: { meeting: MEETING_KEYS }, added: { meeting: ['tasks'] } };

  it('reads back what it wrote, under a heading a person can read', () => {
    const text = shippedPropertiesRecordText(RECORD);
    expect(text).toMatch(/^---\natlas: migration\n---\n\n# Properties added to built-in types\n/);
    expect(parseShippedPropertiesRecord(text)).toEqual(RECORD);
  });

  it('reads a record that says nothing of what was added', () => {
    const text = '---\natlas: migration\n---\n\n```json\n{"settled":{"daily":["tags"]}}\n```\n';
    expect(parseShippedPropertiesRecord(text)).toEqual({
      settled: { daily: ['tags'] },
      added: {},
    });
  });

  it.each([
    ['no list', '---\natlas: migration\n---\n\nNothing here.\n', /no list of keys/],
    ['not JSON', '```json\n{settled\n```\n', /not JSON/],
    ['no settled keys', '```json\n{"added":{}}\n```\n', /which keys are settled/],
    ['keys that are not text', '```json\n{"settled":{"meeting":[1]}}\n```\n', /settled/],
    ['a list for a map', '```json\n{"settled":[]}\n```\n', /settled/],
    ['added that is not keys', '```json\n{"settled":{},"added":{"m":"x"}}\n```\n', /added/],
  ])('refuses a record with %s', (_, text, reason) => {
    const read = () => parseShippedPropertiesRecord(`\n${text}`);
    expect(read).toThrow(ShippedPropertiesRecordError);
    expect(read).toThrow(reason);
  });
});

describe('shippedPropertiesLine', () => {
  it('names the properties and the type', () => {
    expect(shippedPropertiesLine({ label: 'Meeting', added: ['Tasks', 'Decisions'] })).toBe(
      'Added Tasks and Decisions to the Meeting type, which was written before Atlas shipped them.',
    );
    expect(shippedPropertiesLine({ label: 'Daily', added: ['Tags'] })).toBe(
      'Added Tags to the Daily type, which was written before Atlas shipped it.',
    );
  });
});
