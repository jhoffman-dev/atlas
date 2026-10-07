import { describe, expect, it } from 'vitest';
import type { ObjectType } from '../types/property-def.ts';
import {
  movedQuickAddType,
  parseQuickAdd,
  quickAddChoice,
  quickAddStart,
  withoutQuickAddType,
  withQuickAddType,
  QUICK_ADD_LIMIT,
} from './quick-add-types.ts';

const type = (name: string): ObjectType => ({ name, label: name, properties: [] });
const TASK = type('task');
const PROJECT = type('project');
const PERSON = type('person');

describe('parseQuickAdd', () => {
  it('reads an absent key as unset, not as an empty list', () => {
    expect(parseQuickAdd(undefined)).toBeNull();
    expect(parseQuickAdd(null)).toBeNull();
    expect(parseQuickAdd([])).toEqual([]);
  });

  it('reads a list of type names in order', () => {
    expect(parseQuickAdd(['project', 'task'])).toEqual(['project', 'task']);
  });

  it('reads a lone name as a list of one', () => {
    expect(parseQuickAdd('task')).toEqual(['task']);
  });

  it('drops blanks, repeats and values that are not names', () => {
    expect(parseQuickAdd([' task ', '', 'task', { a: 1 }, null, 'project'])).toEqual([
      'task',
      'project',
    ]);
  });

  it('keeps only the first five', () => {
    expect(parseQuickAdd(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('quickAddChoice', () => {
  it('offers Task when the settings say nothing and the vault has a task type', () => {
    expect(quickAddChoice({ configured: null, types: [PROJECT, TASK] })).toEqual({
      types: [TASK],
      missing: [],
    });
  });

  it('offers nothing, and flags nothing, when unset and the vault has no task type', () => {
    expect(quickAddChoice({ configured: null, types: [PROJECT] })).toEqual({
      types: [],
      missing: [],
    });
  });

  it('offers the configured types in the configured order', () => {
    const choice = quickAddChoice({ configured: ['project', 'task'], types: [TASK, PROJECT] });
    expect(choice.types.map((offered) => offered.name)).toEqual(['project', 'task']);
  });

  it('skips a type the vault no longer has, and flags it', () => {
    const choice = quickAddChoice({ configured: ['book', 'task'], types: [TASK] });
    expect(choice.types).toEqual([TASK]);
    expect(choice.missing).toEqual(['book']);
  });

  it('offers nothing when the person took every type away', () => {
    expect(quickAddChoice({ configured: [], types: [TASK] }).types).toEqual([]);
  });

  it('never offers more than five', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const choice = quickAddChoice({ configured: names, types: names.map(type) });
    expect(choice.types).toHaveLength(QUICK_ADD_LIMIT);
  });
});

describe('quickAddStart', () => {
  it('starts an unset list from what is offered now', () => {
    expect(quickAddStart({ configured: null, types: [TASK] })).toEqual(['task']);
    expect(quickAddStart({ configured: null, types: [] })).toEqual([]);
  });

  it('keeps a configured list as it is, missing names included', () => {
    expect(quickAddStart({ configured: ['book'], types: [TASK] })).toEqual(['book']);
  });
});

describe('editing the list', () => {
  it('adds a type at the end', () => {
    expect(withQuickAddType(['task'], 'project')).toEqual(['task', 'project']);
  });

  it('refuses a sixth type and a repeat', () => {
    const full = ['a', 'b', 'c', 'd', 'e'];
    expect(withQuickAddType(full, 'f')).toBe(full);
    expect(withQuickAddType(['task'], 'task')).toEqual(['task']);
  });

  it('removes a type', () => {
    expect(withoutQuickAddType([TASK.name, PERSON.name], 'task')).toEqual(['person']);
  });

  it('moves a type to another place', () => {
    const list = ['task', 'project', 'person'];
    expect(movedQuickAddType({ list, name: 'person', to: 0 })).toEqual([
      'person',
      'task',
      'project',
    ]);
    expect(movedQuickAddType({ list, name: 'task', to: 1 })).toEqual(['project', 'task', 'person']);
  });

  it('clamps a move past either end, and ignores a name not listed', () => {
    const list = ['task', 'project'];
    expect(movedQuickAddType({ list, name: 'task', to: 9 })).toEqual(['project', 'task']);
    expect(movedQuickAddType({ list, name: 'project', to: -3 })).toEqual(['project', 'task']);
    expect(movedQuickAddType({ list, name: 'book', to: 0 })).toBe(list);
  });
});
