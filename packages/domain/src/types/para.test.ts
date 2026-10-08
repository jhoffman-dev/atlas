import { describe, expect, it } from 'vitest';
import { isBuiltInType, typeDeleteRefusal } from './built-in-types.ts';
import {
  AREA_TYPE,
  builtInTypePlan,
  PARA_TYPE_FILES,
  RESOURCE_TYPE,
  typeExtensionLines,
} from './para.ts';
import { parseObjectType, relationTypes, type ObjectType } from './property-def.ts';
import { typeFrontmatter } from './type-frontmatter.ts';

const type = (frontmatter: Record<string, unknown>): ObjectType => parseObjectType(frontmatter);

const PROJECT = type({
  name: 'project',
  properties: { status: 'select', budget: { kind: 'number', label: 'Budget' } },
});
const AREA = type({ name: 'area' });
const RESOURCE = type({
  name: 'resource',
  properties: { project: { kind: 'relation', target: ['project', 'area'] } },
});

const names = (files: readonly { type: ObjectType }[]) => files.map((file) => file.type.name);

describe('builtInTypePlan', () => {
  it('adds every PARA type a vault without types lacks', () => {
    expect(names(builtInTypePlan([]).missing)).toEqual(['project', 'area', 'resource']);
  });

  it('adds the area type to a vault that has projects but no areas', () => {
    const plan = builtInTypePlan([PROJECT, RESOURCE]);
    expect(names(plan.missing)).toEqual([AREA_TYPE]);
  });

  it('never touches a project the vault has: a property James added stays', () => {
    const plan = builtInTypePlan([PROJECT, AREA, RESOURCE]);
    expect(plan.missing).toEqual([]);
    expect(plan.extensions.map((extension) => extension.before.name)).not.toContain('project');
  });

  it('matches a type by name in any case, so a second file is not written beside it', () => {
    const shouting = type({ name: 'Area' });
    expect(names(builtInTypePlan([PROJECT, shouting, RESOURCE]).missing)).toEqual([]);
  });

  it('gives a task with no project one that points at a project or an area', () => {
    const task = type({ name: 'task', properties: { status: 'select', estimate: 'text' } });
    const [extension] = builtInTypePlan([task]).extensions;
    expect(extension?.added.map((property) => property.key)).toEqual(['project']);
    const keys = extension?.after.properties.map((property) => property.key);
    expect(keys).toEqual(['status', 'estimate', 'project']);
    const project = extension?.after.properties.at(-1);
    expect(project === undefined ? [] : relationTypes(project)).toEqual(['project', 'area']);
  });

  it('lets a project relation the vault has point at an area as well, keeping the rest of it', () => {
    const meeting = type({
      name: 'meeting',
      properties: { project: { kind: 'relation', target: 'project', label: 'Work' } },
    });
    const [extension] = builtInTypePlan([meeting]).extensions;
    expect(extension?.added).toEqual([]);
    expect(extension?.widened).toHaveLength(1);
    expect(extension?.after.properties).toEqual([
      { ...meeting.properties[0], targets: ['project', 'area'] },
    ]);
  });

  it('leaves alone a project property of the vault’s own making', () => {
    const asText = type({
      name: 'task',
      properties: { project: { kind: 'text', target: 'project' } },
    });
    const elsewhere = type({
      name: 'meeting',
      properties: { project: { kind: 'relation', target: 'company' } },
    });
    expect(builtInTypePlan([asText, elsewhere]).extensions).toEqual([]);
  });

  it('asks nothing of a relation that already points at both', () => {
    const task = type({
      name: 'task',
      properties: { project: { kind: 'relation', target: ['area', 'project', 'person'] } },
    });
    expect(builtInTypePlan([task]).extensions).toEqual([]);
  });

  it('extends only the types notes are filed by', () => {
    const person = type({ name: 'person', properties: { role: 'text' } });
    expect(builtInTypePlan([person]).extensions).toEqual([]);
  });

  it('writes each PARA type so it reads back as itself', () => {
    for (const { type: written } of PARA_TYPE_FILES) {
      expect(parseObjectType({ name: written.name, ...typeFrontmatter(written) })).toEqual(written);
    }
  });
});

describe('typeExtensionLines', () => {
  it('says what each type gains, in words', () => {
    const task = type({ name: 'task', label: 'Task' });
    const meeting = type({
      name: 'meeting',
      label: 'Meeting',
      properties: { project: { kind: 'relation', target: 'project' } },
    });
    expect(typeExtensionLines(builtInTypePlan([task, meeting]).extensions)).toEqual([
      'Task gains Project, linking project or area notes.',
      "Meeting's Project will link project or area notes.",
    ]);
  });
});

describe('Area and Resource are built in', () => {
  it.each([AREA_TYPE, RESOURCE_TYPE])('%s cannot be deleted', (name) => {
    expect(isBuiltInType(name)).toBe(true);
    expect(typeDeleteRefusal({ name, label: name })).toContain('cannot be deleted');
  });
});
