import { describe, expect, it } from 'vitest';
import { TASK_TYPE_FILE } from '../gtd/task-type.ts';
import { isBuiltInType, typeDeleteRefusal } from '../types/built-in-types.ts';
import { relationTypes, type ObjectType } from '../types/property-def.ts';
import { BLOCK_KEYS, BLOCK_TYPE_FILE, blockTypeToWrite } from './block-type.ts';

/** P31-01: the Block type timeblocks are notes of (ADR-0030). */
const typeNamed = (name: string): ObjectType => ({ name, label: name, properties: [] });

describe('the Block type', () => {
  const property = (key: string) =>
    BLOCK_TYPE_FILE.type.properties.find((candidate) => candidate.key === key);

  it('has a start and an end, both required, and links many tasks', () => {
    expect(property(BLOCK_KEYS.start)).toMatchObject({ kind: 'date', required: true });
    expect(property(BLOCK_KEYS.end)).toMatchObject({ kind: 'date', required: true });
    const tasks = property(BLOCK_KEYS.tasks);
    expect(tasks).toMatchObject({ kind: 'relation', many: true });
    expect(tasks === undefined ? [] : relationTypes(tasks)).toEqual(['task']);
  });

  it('keeps the Google event it is synced with', () => {
    expect(property('gcal_event_id')).toMatchObject({ kind: 'text' });
    expect(property('gcal_etag')).toMatchObject({ kind: 'text' });
  });

  it('is built in: it cannot be deleted, and says why', () => {
    expect(isBuiltInType('block')).toBe(true);
    expect(typeDeleteRefusal({ name: 'block', label: 'Block' })).toContain(
      'timeblocks on the calendar are notes of it',
    );
  });
});

describe('blockTypeToWrite', () => {
  it('writes the Block type into a vault that has tasks and no blocks', () => {
    expect(blockTypeToWrite([TASK_TYPE_FILE.type])).toBe(BLOCK_TYPE_FILE);
    expect(blockTypeToWrite([typeNamed('Task'), typeNamed('project')])).toBe(BLOCK_TYPE_FILE);
  });

  it('writes nothing into a vault with no tasks to schedule', () => {
    expect(blockTypeToWrite([])).toBeNull();
    expect(blockTypeToWrite([typeNamed('project')])).toBeNull();
  });

  it('never writes over a Block type the vault has, in any case', () => {
    expect(blockTypeToWrite([typeNamed('task'), typeNamed('block')])).toBeNull();
    expect(blockTypeToWrite([typeNamed('task'), typeNamed('Block')])).toBeNull();
  });
});
