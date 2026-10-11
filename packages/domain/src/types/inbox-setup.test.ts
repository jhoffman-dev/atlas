import { describe, expect, it } from 'vitest';
import { combinedExtensions, inboxTypePlan } from './inbox-setup.ts';
import { builtInTypePlan, extensionKeys, extensionWithin, typeSetupLines } from './para.ts';
import { parseObjectType, type ObjectType } from './property-def.ts';
import { typeFrontmatter } from './type-frontmatter.ts';

const type = (frontmatter: Record<string, unknown>): ObjectType => parseObjectType(frontmatter);
const keys = (properties: readonly { key: string }[] | undefined) =>
  (properties ?? []).map((property) => property.key);

describe('inboxTypePlan', () => {
  it('names the Proposal and Decision types a vault lacks, matched in any case', () => {
    expect(inboxTypePlan([]).missing.map((file) => file.type.name)).toEqual([
      'proposal',
      'decision',
    ]);
    const plan = inboxTypePlan([type({ name: 'Proposal' }), type({ name: 'decision' })]);
    expect(plan.missing).toEqual([]);
  });

  it('gives a Meeting type the import keys it does not declare, keeping its own', () => {
    const meeting = type({
      name: 'meeting',
      label: 'Meeting',
      properties: { atlas_import_error: { kind: 'text', label: 'Why' }, date: 'date' },
    });
    const [extension] = inboxTypePlan([meeting]).extensions;
    expect(keys(extension?.added)).toEqual(['atlas_import_outcome', 'atlas_duplicate_of']);
    expect(keys(extension?.after.properties)).toEqual([
      'atlas_import_error',
      'date',
      'atlas_import_outcome',
      'atlas_duplicate_of',
    ]);
    expect(extension?.after.properties[0]?.label).toBe('Why');
  });

  it('asks nothing of a Meeting type that declares them all, or of a vault with none', () => {
    const whole = type({
      name: 'meeting',
      properties: {
        atlas_import_outcome: 'select',
        atlas_import_error: 'text',
        atlas_duplicate_of: 'text',
      },
    });
    expect(inboxTypePlan([whole]).extensions).toEqual([]);
    expect(inboxTypePlan([type({ name: 'task' })]).extensions).toEqual([]);
  });

  it('writes each type so it reads back as itself', () => {
    for (const { type: written } of inboxTypePlan([]).missing) {
      expect(parseObjectType({ name: written.name, ...typeFrontmatter(written) })).toEqual(written);
    }
  });
});

describe('combinedExtensions', () => {
  it('makes one change of a type PARA and the Inbox both extend, PARA’s first', () => {
    const meeting = type({ name: 'meeting', label: 'Meeting' });
    const combined = combinedExtensions(
      builtInTypePlan([meeting]).extensions,
      inboxTypePlan([meeting]).extensions,
    );
    expect(combined).toHaveLength(1);
    expect(keys(combined[0]?.after.properties)).toEqual([
      'project',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
    ]);
    expect(typeSetupLines({ types: [], extensions: combined })).toEqual([
      'Meeting gains Project, linking project or area notes. Meeting gains Duplicate of, linking meeting notes. Meeting gains Import and Import error.',
    ]);
  });

  it('keeps a change only one plan makes', () => {
    const task = type({ name: 'task', label: 'Task' });
    const meeting = type({ name: 'meeting', label: 'Meeting', properties: { project: 'text' } });
    const combined = combinedExtensions(
      builtInTypePlan([task, meeting]).extensions,
      inboxTypePlan([task, meeting]).extensions,
    );
    expect(combined.map((extension) => extension.before.name)).toEqual(['task', 'meeting']);
  });
});

describe('extensionWithin', () => {
  it('keeps only the part of a change an offer showed, worked out from the type as it was', () => {
    const meeting = type({ name: 'meeting', label: 'Meeting', properties: { date: 'date' } });
    const [both] = combinedExtensions(
      builtInTypePlan([meeting]).extensions,
      inboxTypePlan([meeting]).extensions,
    );
    if (both === undefined) throw new Error('Meeting should be extended');
    const onlyImport = extensionWithin(both, new Set(['atlas_import_error']));
    expect(keys(onlyImport?.added)).toEqual(['atlas_import_error']);
    expect(keys(onlyImport?.after.properties)).toEqual(['date', 'atlas_import_error']);
    expect(extensionWithin(both, new Set(['somewhere else']))).toBeNull();
    expect(extensionKeys(both)).toEqual(
      new Set(['project', 'atlas_import_outcome', 'atlas_import_error', 'atlas_duplicate_of']),
    );
  });
});
