import { describe, expect, it } from 'vitest';
import { isBuiltInType, typeDeleteRefusal } from './built-in-types.ts';
import {
  AREA_TYPE,
  builtInTypePlan,
  PARA_KEY,
  PARA_TYPE_FILES,
  RESOURCE_TYPE,
  typeSetupLines,
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
  it('names the one PARA type a vault without types lacks, and only offers it (#213)', () => {
    const plan = builtInTypePlan([]);
    expect(names(plan.missing)).toEqual(['project']);
    expect(plan.filesByProject).toBe(false);
  });

  it('offers no `project` on a type two files claim, as its readers take the first', () => {
    const meeting = type({ name: 'meeting', label: 'Meeting' });
    const copy = type({ name: 'Meeting', label: 'Meeting (conflict copy)' });
    expect(builtInTypePlan([meeting, copy]).extensions).toEqual([]);
    expect(builtInTypePlan([meeting]).extensions).toHaveLength(1);
  });

  it('counts a vault with a Project type as one that files by project', () => {
    expect(builtInTypePlan([PROJECT]).filesByProject).toBe(true);
    expect(builtInTypePlan([type({ name: 'Project' })]).filesByProject).toBe(true);
    expect(builtInTypePlan([AREA]).filesByProject).toBe(false);
  });

  it('writes no Area or Resource type into a vault that has projects: PARA is a property now (#213)', () => {
    expect(builtInTypePlan([PROJECT]).missing).toEqual([]);
    expect(builtInTypePlan([PROJECT, RESOURCE]).missing).toEqual([]);
  });

  it('offers a Project type without them PARA and Area, after what the vault has (#213)', () => {
    const [extension] = builtInTypePlan([PROJECT, AREA, RESOURCE]).extensions;
    expect(extension?.before).toBe(PROJECT);
    expect(extension?.added.map((property) => property.key)).toEqual([PARA_KEY, 'area']);
    expect(extension?.widened).toEqual([]);
    expect(extension?.after.properties.map((property) => property.key)).toEqual([
      'status',
      'budget',
      PARA_KEY,
      'area',
    ]);
    const para = extension?.after.properties.find((property) => property.key === PARA_KEY);
    expect(para).toMatchObject({ kind: 'select', label: 'PARA', required: false });
    expect(para?.options).toEqual(['project', 'area', 'resource', 'archive']);
    const area = extension?.after.properties.find((property) => property.key === 'area');
    expect(area).toMatchObject({ kind: 'relation', required: false, target: AREA_TYPE });
  });

  it('never touches a key the Project type has: one James wrote his own way stays', () => {
    const own = type({
      name: 'project',
      properties: { para: 'text', area: { kind: 'relation', target: 'company' } },
    });
    expect(builtInTypePlan([own]).extensions).toEqual([]);
    const half = type({ name: 'project', properties: { para: 'text' } });
    expect(builtInTypePlan([half]).extensions[0]?.added.map((p) => p.key)).toEqual(['area']);
  });

  it('offers nothing on a Project type two files claim', () => {
    const copy = type({ name: 'Project', label: 'Project (conflict copy)' });
    expect(builtInTypePlan([PROJECT, copy]).extensions).toEqual([]);
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

describe('typeSetupLines', () => {
  it('says what each type gains, in words', () => {
    const task = type({ name: 'task', label: 'Task' });
    const meeting = type({
      name: 'meeting',
      label: 'Meeting',
      properties: { project: { kind: 'relation', target: 'project' } },
    });
    const plan = builtInTypePlan([PROJECT, AREA, RESOURCE, task, meeting]);
    expect(typeSetupLines({ types: plan.missing, extensions: plan.extensions })).toEqual([
      'project gains Area, linking area notes. project gains PARA.',
      'Task gains Project, linking project or area notes.',
      "Meeting's Project will link project or area notes.",
    ]);
  });

  it('names the types it would add first', () => {
    const task = type({ name: 'task', label: 'Task' });
    const plan = builtInTypePlan([task]);
    expect(typeSetupLines({ types: plan.missing, extensions: plan.extensions })).toEqual([
      'Adds the Project type.',
      'Task gains Project, linking project or area notes.',
    ]);
  });
});

describe('Area and Resource are no longer built in (#213)', () => {
  it.each([AREA_TYPE, RESOURCE_TYPE])('%s can be deleted once its notes have moved', (name) => {
    expect(isBuiltInType(name)).toBe(false);
    expect(typeDeleteRefusal({ name, label: name })).toBeNull();
  });

  it('keeps Project built in: PARA is its notes', () => {
    expect(isBuiltInType('Project')).toBe(true);
    expect(typeDeleteRefusal({ name: 'project', label: 'Project' })).toContain('cannot be deleted');
  });
});
