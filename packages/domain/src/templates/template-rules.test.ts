import { describe, expect, it } from 'vitest';
import { KeyAsWritten } from '../markdown/frontmatter-key.ts';
import type { ObjectType, PropertyDef } from '../types/property-def.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  compareTemplates,
  isTemplateFor,
  isTemplateNamed,
  templateNameOf,
  templateNameProblem,
  templatePathFor,
  templateUses,
  typeTemplateFrontmatter,
  typeTemplateName,
  typesWithoutTemplate,
  usesLost,
} from './template-rules.ts';
import { isTemplateNote } from '../vault/vault-visibility.ts';

const property = (key: string): PropertyDef => ({
  key,
  kind: 'text',
  label: key,
  required: false,
  options: [],
  target: null,
  many: false,
});

const PERSON: ObjectType = { name: 'person', label: 'Person', properties: [property('role')] };
const TASK: ObjectType = { name: 'task', label: 'Task', properties: [] };
const BOOK: ObjectType = { name: 'book', label: 'Reading list', properties: [] };
const TYPES = [PERSON, TASK, BOOK];

describe('which type a template serves', () => {
  it('serves the type it is named after, by label or name, in any case', () => {
    expect(isTemplateFor('Person', PERSON)).toBe(true);
    expect(isTemplateFor(' person ', PERSON)).toBe(true);
    expect(isTemplateFor('Reading list', BOOK)).toBe(true);
    expect(isTemplateFor('book', BOOK)).toBe(true);
  });

  it('names a template trimmed, in any case and either Unicode normalisation', () => {
    expect(isTemplateNamed('Caf\u00e9', ' cafe\u0301 ')).toBe(true);
    expect(isTemplateNamed('TASK', 'task')).toBe(true);
    expect(isTemplateNamed('Task', 'Tasks')).toBe(false);
    expect(isTemplateFor('Cafe\u0301', { name: 'cafe', label: 'Caf\u00e9' })).toBe(true);
  });

  it('orders templates by name as lookups compare it, then nearer the top, then as written', () => {
    const sorted = [
      { name: 'meeting', depth: 3 },
      { name: ' Meeting', depth: 4 },
      { name: 'Zoo', depth: 2 },
      { name: 'Meeting', depth: 2 },
      { name: 'agenda', depth: 2 },
      { name: 'MEETING', depth: 2 },
    ].sort(compareTemplates);

    expect(sorted.map(({ name, depth }) => `${name}@${depth}`)).toEqual([
      'agenda@2',
      'Meeting@2',
      'MEETING@2',
      'meeting@3',
      ' Meeting@4',
      'Zoo@2',
    ]);
  });

  it('does not serve a type it merely starts like', () => {
    expect(isTemplateFor('Person notes', PERSON)).toBe(false);
    expect(isTemplateFor('Pers', PERSON)).toBe(false);
  });

  it('lists the type it serves, and the day note, capture and artifacts by their names', () => {
    expect(templateUses('Person', TYPES)).toEqual([
      { kind: 'type', typeName: 'person', typeLabel: 'Person' },
    ]);
    expect(templateUses('task', TYPES)).toEqual([
      { kind: 'type', typeName: 'task', typeLabel: 'Task' },
      { kind: 'capture' },
    ]);
    expect(templateUses('Daily', TYPES)).toEqual([{ kind: 'daily' }]);
    expect(templateUses('Artifact', [])).toEqual([{ kind: 'artifact' }]);
  });

  it('lists nothing for a template only the New menu offers', () => {
    expect(templateUses('Meeting', TYPES)).toEqual([]);
  });

  it('names every type that would answer to the same template', () => {
    const twin: ObjectType = { name: 'Person', label: 'Human', properties: [] };
    expect(templateUses('Person', [PERSON, twin])).toHaveLength(2);
  });

  it('finds the types with no template among the names given', () => {
    expect(typesWithoutTemplate(TYPES, ['person', 'Meeting'])).toEqual([TASK, BOOK]);
    expect(typesWithoutTemplate(TYPES, [])).toEqual(TYPES);
  });
});

describe('naming a template', () => {
  it('names a type’s template after the type’s label', () => {
    expect(typeTemplateName(BOOK)).toBe('Reading list');
  });

  it.each([
    ['a label a file name cannot hold', { name: 'q_a', label: 'Q&A / Notes' }],
    ['a label that starts with a dot', { name: 'net_project', label: '.NET project' }],
    ['a label too long for a file name', { name: 'long_type', label: 'x'.repeat(300) }],
  ])('names it after the type’s name instead, for %s', (_what, type) => {
    expect(typeTemplateName(type)).toBe(type.name);
  });

  it('keeps it in the templates folder, and reads its name back from the path', () => {
    expect(templatePathFor(' Person ')).toBe('.atlas/templates/Person.md');
    expect(templateNameOf(createVaultPath('.atlas/templates/Person.md'))).toBe('Person');
  });

  it.each([
    ['', 'Name the template.'],
    ['   ', 'Name the template.'],
    ['a/b', 'A template’s name cannot hold / \\ : * ? " < > or |.'],
    ['what?', 'A template’s name cannot hold / \\ : * ? " < > or |.'],
    ['.hidden', 'A template’s name cannot start with a dot.'],
    ['x'.repeat(260), 'A template’s name is too long for a file name.'],
  ])('refuses %j', (name, problem) => {
    expect(templateNameProblem({ name, takenPaths: [] })).toBe(problem);
  });

  it('refuses a name already taken, in any case or composition', () => {
    const takenPaths = ['.atlas/templates/Café.md'];
    expect(templateNameProblem({ name: 'CAFÉ', takenPaths })).toBe(
      'There is already a template called “CAFÉ”.',
    );
    expect(templateNameProblem({ name: 'Café', takenPaths })).not.toBeNull();
    expect(templateNameProblem({ name: 'Tea', takenPaths })).toBeNull();
  });

  it('lets a template be renamed to its own name in another case', () => {
    const own = '.atlas/templates/person.md';
    expect(templateNameProblem({ name: 'Person', takenPaths: [own], except: own })).toBeNull();
    expect(
      templateNameProblem({
        name: 'Person',
        takenPaths: [own, '.atlas/templates/Task.md'],
        except: '.atlas/templates/Task.md',
      }),
    ).not.toBeNull();
  });
});

describe('what renaming or deleting a template stops', () => {
  const types = [{ name: 'person', label: 'Person' }];

  it('is every use, when it is deleted', () => {
    expect(usesLost({ from: 'Daily', to: null, types })).toEqual([{ kind: 'daily' }]);
  });

  it('is the uses its new name does not keep', () => {
    expect(usesLost({ from: 'Person', to: 'Contact', types })).toEqual([
      { kind: 'type', typeName: 'person', typeLabel: 'Person' },
    ]);
    expect(usesLost({ from: 'Person', to: 'person', types })).toEqual([]);
  });
});

describe('the templates folder, in any case', () => {
  it('holds a template under .atlas/Templates, the same folder on the Mac’s disk', () => {
    expect(isTemplateNote('.atlas/Templates/Company.md')).toBe(true);
    expect(isTemplateNote('Templates/Company.md')).toBe(false);
  });
});

describe('what a type’s new template starts with', () => {
  it('says the type, and leaves each property an empty key to fill', () => {
    const frontmatter = typeTemplateFrontmatter({
      name: 'person',
      properties: [property('role'), property('email')],
    });
    expect(frontmatter['type']).toBe('person');
    expect(frontmatter['role']).toEqual(new KeyAsWritten('role:\n'));
    expect(frontmatter['email']).toEqual(new KeyAsWritten('email:\n'));
    expect(Object.keys(frontmatter)).toEqual(['type', 'role', 'email']);
  });

  it('never lets a property called type say another type', () => {
    const frontmatter = typeTemplateFrontmatter({ name: 'person', properties: [property('type')] });
    expect(frontmatter).toEqual({ type: 'person' });
  });
});
