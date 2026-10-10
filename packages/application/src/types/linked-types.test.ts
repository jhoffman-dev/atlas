import { describe, expect, it } from 'vitest';
import { createVaultPath, parseObjectType, type VaultPath } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { linkedTypeProblems } from './linked-types.ts';

const TASK = parseObjectType({
  name: 'task',
  properties: {
    project: { kind: 'relation', target: ['project', 'area'] },
    status: 'select',
  },
});

const FILES: Record<string, string> = {
  'Projects/Atlas.md': '---\ntype: project\n---\n',
  'Areas/Garden.md': '---\ntype: area\n---\n',
  'People/Mara Quill.md': '---\ntype: person\n---\n',
  'Loose.md': 'No type at all.\n',
};

function check(values: Record<string, unknown>) {
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = FILES[path];
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  const notePaths: VaultPath[] = Object.keys(FILES).map(createVaultPath);
  return linkedTypeProblems({
    fs,
    markdown: fakeMarkdown(),
    properties: TASK.properties,
    values,
    notePaths,
  });
}

describe('linkedTypeProblems', () => {
  it('refuses a link to a note of a type the relation does not point at', async () => {
    expect(await check({ project: '[[Mara Quill]]' })).toEqual({
      project: 'Project links to a project or area, not a person',
    });
  });

  it('lets through a link to any type it points at', async () => {
    expect(await check({ project: '[[Atlas]]' })).toEqual({});
    expect(await check({ project: '[[Garden]]' })).toEqual({});
  });

  it('lets through a link to a note not written yet, or one with no type', async () => {
    expect(await check({ project: '[[Someday]]' })).toEqual({});
    expect(await check({ project: '[[Loose]]' })).toEqual({});
  });

  it('judges every link of several, and only relations', async () => {
    expect(
      await check({ project: ['[[Atlas]]', '[[Mara Quill]]'], status: '[[Mara Quill]]' }),
    ).toEqual({ project: 'Project links to a project or area, not a person' });
  });

  it('reads nothing when no relation is being set', async () => {
    expect(await check({ status: 'done' })).toEqual({});
  });
});
