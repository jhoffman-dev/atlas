import { describe, expect, it } from 'vitest';
import { PARA_KEY, PARA_TYPE_FILES, PROJECT_TYPE_FILE } from './para.ts';
import {
  isParaArchived,
  isParaNote,
  isParaTarget,
  paraArchiveToggle,
  paraChoices,
  paraDefaultFor,
  paraOf,
  paraValueNamed,
  paraValuesTargeted,
  relatedNoteKind,
  relationGroupLabel,
} from './para-value.ts';
import { parseObjectType } from './property-def.ts';
import { relationTypeRefusal } from './property-value.ts';
import { typeFrontmatter } from './type-frontmatter.ts';

/** #213: PARA is a property of the one Project type. */
describe('the Project type Atlas writes', () => {
  it('is the only PARA type, and carries PARA and an optional Area', () => {
    expect(PARA_TYPE_FILES).toEqual([PROJECT_TYPE_FILE]);
    const { properties } = PROJECT_TYPE_FILE.type;
    const para = properties.find((property) => property.key === PARA_KEY);
    expect(para).toMatchObject({ kind: 'select', label: 'PARA', required: false });
    expect(para?.options).toEqual(['project', 'area', 'resource', 'archive']);
    const area = properties.find((property) => property.key === 'area');
    expect(area).toMatchObject({ kind: 'relation', target: 'area', required: false, many: false });
    expect(properties.every((property) => !property.required)).toBe(true);
  });

  it('reads back as itself from the file it is written as', () => {
    const { type } = PROJECT_TYPE_FILE;
    expect(parseObjectType({ name: type.name, ...typeFrontmatter(type) })).toEqual(type);
  });
});

describe('paraValueNamed', () => {
  it('reads each of the four in any case and spacing', () => {
    expect(paraValueNamed('project')).toBe('project');
    expect(paraValueNamed(' Area ')).toBe('area');
    expect(paraValueNamed('RESOURCE')).toBe('resource');
    expect(paraValueNamed('archive')).toBe('archive');
  });

  it('names nothing for anything else', () => {
    for (const value of ['someday', '', null, undefined, 3, ['archive'], { para: 'area' }]) {
      expect(paraValueNamed(value)).toBeNull();
    }
  });
});

describe('isParaNote and paraOf', () => {
  it('counts a Project note in any case as PARA’s, and nothing else', () => {
    expect(isParaNote({ type: 'project' })).toBe(true);
    expect(isParaNote({ type: ' Project ' })).toBe(true);
    expect(isParaNote({ type: 'area' })).toBe(false);
    expect(isParaNote({ type: 'task' })).toBe(false);
    expect(isParaNote({ type: ['project'] })).toBe(false);
    expect(isParaNote({})).toBe(false);
  });

  it('reads a Project by its `para`, and as a project when it has none it can read', () => {
    expect(paraOf({ type: 'project', para: 'area' })).toBe('area');
    expect(paraOf({ type: 'Project', para: 'Archive' })).toBe('archive');
    expect(paraOf({ type: 'project', para: undefined })).toBe('project');
    expect(paraOf({ type: 'project', para: 'someday' })).toBe('project');
  });

  it('reads a note of the Area or Resource type from before #213 as the value its type names', () => {
    expect(paraOf({ type: 'area', para: undefined })).toBe('area');
    expect(paraOf({ type: 'Resource', para: 'archive' })).toBe('resource');
  });

  it('places any other note nowhere', () => {
    expect(paraOf({ type: 'task', para: 'area' })).toBeNull();
    expect(paraOf({ type: undefined, para: 'area' })).toBeNull();
  });
});

describe('archiving a PARA note is a value (#213)', () => {
  it('archives a Project by setting PARA to archive, whatever it was', () => {
    for (const para of [undefined, 'project', 'area', 'resource', 'someday']) {
      expect(paraArchiveToggle({ type: 'project', para })).toEqual({
        action: 'archive',
        para: 'archive',
      });
    }
  });

  it('unarchives an archived Project by setting PARA back to project', () => {
    expect(isParaArchived({ type: 'project', para: ' Archive ' })).toBe(true);
    expect(paraArchiveToggle({ type: 'project', para: 'archive' })).toEqual({
      action: 'unarchive',
      para: 'project',
    });
  });

  it('leaves every other note to the Archive folder', () => {
    expect(paraArchiveToggle({ type: 'task', para: 'archive' })).toBeNull();
    expect(paraArchiveToggle({ type: 'area' })).toBeNull();
    expect(paraArchiveToggle({})).toBeNull();
    expect(isParaArchived({ type: 'task', para: 'archive' })).toBe(false);
  });
});

describe('PARA relations', () => {
  it('knows project, area and resource as PARA targets, in any case', () => {
    expect(['project', 'Area', ' resource '].every(isParaTarget)).toBe(true);
    expect(isParaTarget('archive')).toBe(false);
    expect(isParaTarget('person')).toBe(false);
  });

  it('offers the values a relation points at, in PARA’s order, never archive', () => {
    expect(paraValuesTargeted(['area', 'project'])).toEqual(['project', 'area']);
    expect(paraValuesTargeted(['area'])).toEqual(['area']);
    expect(paraValuesTargeted(['resource', 'Project', 'archive', 'person'])).toEqual([
      'project',
      'resource',
    ]);
    expect(paraValuesTargeted(['person'])).toEqual([]);
  });

  const notes = [
    { path: 'Home.md', title: 'Home', para: 'area' as const },
    { path: 'Atlas.md', title: 'Atlas', para: 'project' as const },
    { path: 'Manual.md', title: 'Manual', para: 'resource' as const },
    { path: 'Old.md', title: 'Old', para: 'archive' as const },
    { path: 'Garden.md', title: 'Garden', para: 'area' as const },
  ];

  it('groups a task’s Project picker as projects then areas: no resource, nothing archived', () => {
    expect(paraChoices(notes, ['project', 'area']).map((note) => note.title)).toEqual([
      'Atlas',
      'Home',
      'Garden',
    ]);
  });

  it('offers a project’s Area picker only areas', () => {
    expect(paraChoices(notes, ['area']).map((note) => note.title)).toEqual(['Home', 'Garden']);
  });

  it('never offers an archived note, even to a relation naming archive', () => {
    const titles = paraChoices(notes, ['project', 'area', 'resource', 'archive']).map(
      (note) => note.title,
    );
    expect(titles).toEqual(['Atlas', 'Home', 'Garden', 'Manual']);
  });

  it('heads PARA’s groups as PARA does, and any other type by its name', () => {
    expect(relationGroupLabel('project')).toBe('Projects');
    expect(relationGroupLabel('area')).toBe('Areas');
    expect(relationGroupLabel('resource')).toBe('Resources');
    expect(relationGroupLabel('archive')).toBe('Archive');
    expect(relationGroupLabel('person')).toBe('Person');
  });

  it('accepts a Project note in any PARA relation, whatever its type name says', () => {
    const area = PROJECT_TYPE_FILE.type.properties.find((property) => property.key === 'area');
    if (area === undefined) throw new Error('the Project type has no area');
    expect(relationTypeRefusal({ def: area, linkedType: 'project' })).toBeNull();
    expect(relationTypeRefusal({ def: area, linkedType: 'Project' })).toBeNull();
    expect(relationTypeRefusal({ def: area, linkedType: 'area' })).toBeNull();
    expect(relationTypeRefusal({ def: area, linkedType: 'person' })).toBe(
      'Area links to a area, not a person',
    );
  });

  it('keeps refusing a Project note where the relation is not PARA’s', () => {
    const company = parseObjectType({
      name: 'person',
      properties: { company: { kind: 'relation', target: 'company' } },
    }).properties[0];
    if (company === undefined) throw new Error('no company relation');
    expect(relationTypeRefusal({ def: company, linkedType: 'project' })).toBe(
      'Company links to a company, not a project',
    );
  });
});

describe('paraDefaultFor', () => {
  const project = PROJECT_TYPE_FILE.type;

  it('starts a new project as a project', () => {
    expect(paraDefaultFor({ type: project, starting: { type: 'project' } })).toEqual({
      para: 'project',
    });
    expect(
      paraDefaultFor({ type: { ...project, name: 'Project' }, starting: { para: '  ' } }),
    ).toEqual({ para: 'project' });
  });

  it('keeps what its template or its fields say', () => {
    expect(paraDefaultFor({ type: project, starting: { para: 'area' } })).toEqual({});
    expect(paraDefaultFor({ type: project, starting: { para: 'someday' } })).toEqual({});
  });

  it('gives nothing to a Project type that does not declare PARA, or to another type', () => {
    const bare = parseObjectType({ name: 'project', properties: { status: 'select' } });
    expect(paraDefaultFor({ type: bare, starting: {} })).toEqual({});
    const task = parseObjectType({ name: 'task', properties: { para: 'select' } });
    expect(paraDefaultFor({ type: task, starting: {} })).toEqual({});
  });
});

describe('relatedNoteKind', () => {
  const project = PROJECT_TYPE_FILE.type;
  const area = parseObjectType({ name: 'area', properties: {} });
  const company = parseObjectType({ name: 'company', properties: {} });

  it('makes New area… a Project whose PARA is area, where the Project type has PARA', () => {
    expect(relatedNoteKind({ target: 'area', types: [area, project, company] })).toEqual({
      type: project,
      values: { para: 'area' },
    });
    expect(relatedNoteKind({ target: 'resource', types: [project] })?.values).toEqual({
      para: 'resource',
    });
    expect(relatedNoteKind({ target: 'project', types: [project] })?.values).toEqual({
      para: 'project',
    });
  });

  it('makes a note of the type named where the Project type has no PARA, or for any other type', () => {
    const bare = parseObjectType({ name: 'project', properties: { status: 'select' } });
    expect(relatedNoteKind({ target: 'area', types: [bare, area] })).toEqual({
      type: area,
      values: {},
    });
    expect(relatedNoteKind({ target: 'company', types: [project, company] })).toEqual({
      type: company,
      values: {},
    });
  });

  it('has nothing to make where the vault has no such type', () => {
    expect(relatedNoteKind({ target: 'area', types: [company] })).toBeNull();
    expect(relatedNoteKind({ target: 'person', types: [project] })).toBeNull();
  });
});
