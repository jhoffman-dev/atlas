import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  declaredTypeName,
  isBuiltInType,
  isBuiltInTypeFile,
  typeDeleteRefusal,
} from './built-in-types.ts';

describe('built-in types', () => {
  it('are Person, Task, Project, Artifact, Meeting, Company and Term — the seven a feature is built on', () => {
    for (const name of [
      'person',
      'task',
      'project',
      'artifact',
      'meeting',
      'company',
      'term',
      ' Person ',
      'TASK',
    ]) {
      expect(isBuiltInType(name)).toBe(true);
    }
    for (const name of ['event', 'people', 'terms', '']) {
      expect(isBuiltInType(name)).toBe(false);
    }
  });

  it('cannot be deleted, and the type editor says why and what can still change', () => {
    const refusal = typeDeleteRefusal({ name: 'person', label: 'Person' });
    expect(refusal).toMatch(/^Person is built in/);
    expect(refusal).toMatch(/@ mentions/);
    expect(refusal).toMatch(/properties are yours to change/);
    expect(typeDeleteRefusal({ name: 'artifact', label: 'Saved page' })).toMatch(
      /^Saved page is built in — saved artifacts/,
    );
  });

  it('include Meeting, which imported meetings are notes of, so it cannot be deleted', () => {
    expect(typeDeleteRefusal({ name: 'meeting', label: 'Meeting' })).toMatch(
      /^Meeting is built in — imported meetings are notes of it — so it cannot be deleted/,
    );
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/meeting.md'))).toBe(true);
  });

  it('include Company and Term, which terms and the Terms page are built on (P28-05)', () => {
    expect(typeDeleteRefusal({ name: 'company', label: 'Company' })).toMatch(
      /^Company is built in — meetings and terms point at companies — so it cannot be deleted/,
    );
    expect(typeDeleteRefusal({ name: 'term', label: 'Term' })).toMatch(
      /^Term is built in — the Terms page lists its notes/,
    );
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/company.md'))).toBe(true);
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/term.md'))).toBe(true);
  });

  it('leaves a type of your own free to delete', () => {
    expect(typeDeleteRefusal({ name: 'event', label: 'Event' })).toBeNull();
  });

  it('are known by their file only in the types folder', () => {
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/project.md'))).toBe(true);
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/Project.MD'))).toBe(true);
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/nested/project.md'))).toBe(false);
    expect(isBuiltInTypeFile(createVaultPath('.atlas/templates/Project.md'))).toBe(false);
    expect(isBuiltInTypeFile(createVaultPath('project.md'))).toBe(false);
    expect(isBuiltInTypeFile(createVaultPath('.atlas/types/project.txt'))).toBe(false);
  });

  it('are known by the `name:` a type file declares, whatever the file is called', () => {
    const file = createVaultPath('.atlas/types/People.md');
    expect(isBuiltInTypeFile(file, 'person')).toBe(true);
    expect(isBuiltInTypeFile(file, 'event')).toBe(false);
    expect(isBuiltInTypeFile(file)).toBe(false);
    expect(isBuiltInTypeFile(createVaultPath('Notes/People.md'), 'person')).toBe(false);
  });
});

describe('the type a type file declares', () => {
  it('is its `name:`, quoted or not', () => {
    expect(declaredTypeName('name: person\nlabel: Person\n')).toBe('person');
    expect(declaredTypeName('label: People\nname: "person"\n')).toBe('person');
    expect(declaredTypeName("name: 'task'  \n")).toBe('task');
  });

  it('is nothing when there is no `name:` at the top level', () => {
    expect(declaredTypeName('label: Person\n')).toBeNull();
    expect(declaredTypeName('properties:\n  name: text\n')).toBeNull();
    expect(declaredTypeName('name:\n')).toBeNull();
    expect(declaredTypeName('fullname: person\n')).toBeNull();
  });
});
