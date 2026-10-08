import { describe, expect, it } from 'vitest';
import {
  parseObjectType,
  relationTypes,
  relationTypesText,
  type ObjectType,
  type PropertyDef,
} from './property-def.ts';
import { relationTypeRefusal, validatePropertyValue } from './property-value.ts';
import { changePropertyKind, setRelation } from './type-edit.ts';
import { propertySpec, typeFrontmatter, typeFrontmatterChanges } from './type-frontmatter.ts';

const TASK: ObjectType = parseObjectType({
  name: 'task',
  properties: {
    project: { kind: 'relation', target: ['project', 'area'] },
    owner: { kind: 'relation', target: 'person' },
  },
});

const project = (type: ObjectType = TASK): PropertyDef =>
  type.properties.find((property) => property.key === 'project')!;

describe('a relation that points at several types', () => {
  it('reads every type a list names, the first as its target', () => {
    expect(project()).toMatchObject({ target: 'project', targets: ['project', 'area'] });
    expect(relationTypes(project())).toEqual(['project', 'area']);
  });

  it('reads a relation to one type exactly as before: no list beside it', () => {
    const owner = TASK.properties.find((property) => property.key === 'owner')!;
    expect(owner.target).toBe('person');
    expect(owner).not.toHaveProperty('targets');
    expect(relationTypes(owner)).toEqual(['person']);
  });

  it('drops a blank or repeated type from the list', () => {
    const type = parseObjectType({
      name: 'note',
      properties: { project: { kind: 'relation', target: [' area ', '', 'area', 'project'] } },
    });
    expect(relationTypes(project(type))).toEqual(['area', 'project']);
  });

  it('is no relation when the list names nothing', () => {
    const type = parseObjectType({
      name: 'note',
      properties: { project: { kind: 'relation', target: ['', ' '] } },
    });
    expect(type.properties).toEqual([]);
  });

  it('a one-item list is a relation to that one type', () => {
    const type = parseObjectType({
      name: 'note',
      properties: { project: { kind: 'relation', target: ['area'] } },
    });
    expect(project(type)).toMatchObject({ target: 'area' });
    expect(project(type)).not.toHaveProperty('targets');
  });

  it('names its types in words', () => {
    expect(relationTypesText(project())).toBe('project or area');
    expect(relationTypesText({ target: 'person' })).toBe('person');
    expect(relationTypesText({ target: 'a', targets: ['a', 'b', 'c'] })).toBe('a, b or c');
    expect(relationTypesText({ target: null })).toBe('note');
  });

  it('says so when a value is not a link', () => {
    expect(validatePropertyValue({ def: project(), value: 'Garden' })).toBe(
      'Project must be a link to a project or area',
    );
  });
});

describe('relationTypeRefusal', () => {
  it('lets through a note of any type the relation points at', () => {
    expect(relationTypeRefusal({ def: project(), linkedType: 'project' })).toBeNull();
    expect(relationTypeRefusal({ def: project(), linkedType: 'area' })).toBeNull();
  });

  it('refuses a note of another type, naming what it takes', () => {
    expect(relationTypeRefusal({ def: project(), linkedType: 'person' })).toBe(
      'Project links to a project or area, not a person',
    );
  });

  it('lets through a note whose type is not known', () => {
    expect(relationTypeRefusal({ def: project(), linkedType: null })).toBeNull();
  });
});

describe('writing a relation to several types', () => {
  it('writes the list back, and parses back to the same type', () => {
    expect(propertySpec(project())).toEqual({ kind: 'relation', target: ['project', 'area'] });
    expect(parseObjectType({ name: 'task', ...typeFrontmatter(TASK) })).toEqual(TASK);
  });

  it('adding a type to a relation is an edit to that relation alone', () => {
    const before = parseObjectType({
      name: 'task',
      properties: { project: { kind: 'relation', target: 'project', mine: 1 } },
    });
    const after: ObjectType = {
      ...before,
      properties: [{ ...project(before), targets: ['project', 'area'] }],
    };
    const written = { properties: { project: { kind: 'relation', target: 'project', mine: 1 } } };
    expect(typeFrontmatterChanges({ before, after, written })).toEqual({
      properties: { project: { kind: 'relation', target: ['project', 'area'], mine: 1 } },
    });
  });
});

describe('editing a relation to several types', () => {
  it('keeps the other types when only "several notes" changes', () => {
    const edited = setRelation(TASK, {
      key: 'project',
      target: 'project',
      many: true,
      types: ['project', 'area'],
    });
    expect(project(edited)).toMatchObject({ many: true, targets: ['project', 'area'] });
  });

  it('points at the one type chosen when the target changes', () => {
    const edited = setRelation(TASK, {
      key: 'project',
      target: 'area',
      many: false,
      types: ['project', 'area'],
    });
    expect(relationTypes(project(edited))).toEqual(['area']);
    expect(project(edited)).not.toHaveProperty('targets');
  });

  it('forgets the types once it is no longer a relation', () => {
    const text = changePropertyKind(TASK, { key: 'project', kind: 'text' });
    expect(project(text)).not.toHaveProperty('targets');
    expect(propertySpec(project(text))).toBe('text');
  });
});
