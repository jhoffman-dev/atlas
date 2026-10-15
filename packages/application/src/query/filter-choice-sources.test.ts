import { describe, expect, it } from 'vitest';
import { createVaultPath, noteNames, type ObjectType, type PropertyDef } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { loadFilterChoiceSources } from './filter-choice-sources.ts';

/* #212: what a filter offers that only the index knows — a relation's notes, the vault's tags. */

const property = (key: string, kind: PropertyDef['kind'], target: string | null = null) => ({
  key,
  kind,
  label: key,
  required: false,
  options: [],
  target,
  many: false,
});

const taskType = (properties: readonly PropertyDef[]): ObjectType => ({
  name: 'task',
  label: 'Task',
  properties,
});

const names = noteNames([
  { path: createVaultPath('projects/Quill audit.md'), title: 'Quill audit' },
  { path: createVaultPath('projects/Larkspur launch.md'), title: 'Larkspur launch' },
]);

describe('loadFilterChoiceSources', () => {
  it('offers each relation the notes of the type it points at, by title', async () => {
    const asked: string[] = [];
    const sources = await loadFilterChoiceSources({
      index: fakeIndexPort({
        notesOfType: async (type) => {
          asked.push(type);
          return [
            { path: 'projects/Quill audit.md', title: 'Quill audit' },
            { path: 'projects/Larkspur launch.md', title: 'Larkspur launch' },
          ];
        },
      }),
      type: taskType([property('project', 'relation', 'project'), property('status', 'select')]),
      names,
    });

    expect(asked).toEqual(['project']);
    expect(sources.related).toEqual({
      project: [
        { value: '[[Larkspur launch]]', label: 'Larkspur launch' },
        { value: '[[Quill audit]]', label: 'Quill audit' },
      ],
    });
    expect(sources.tags).toEqual([]);
  });

  it('reads the vault’s tags only for a type with a `tags` property', async () => {
    const queries: string[] = [];
    const index = fakeIndexPort({
      query: async (sql) => {
        queries.push(sql);
        return {
          columns: ['key', 'name', 'count'],
          rows: [
            ['errand', 'errand', 2],
            ['q3', 'Q3', 1],
          ],
          truncated: false,
        };
      },
    });

    const tagged = await loadFilterChoiceSources({
      index,
      type: taskType([property('tags', 'multiSelect')]),
      names,
    });
    expect(tagged.tags).toEqual(['errand', 'Q3']);

    queries.length = 0;
    const untagged = await loadFilterChoiceSources({
      index,
      type: taskType([property('status', 'select')]),
      names,
    });
    expect(untagged).toEqual({ tags: [], related: {} });
    expect(queries).toEqual([]);
  });

  it('fails as the index fails, so the caller decides what to offer instead', async () => {
    await expect(
      loadFilterChoiceSources({
        index: fakeIndexPort({ notesOfType: () => Promise.reject(new Error('not ready')) }),
        type: taskType([property('project', 'relation', 'project')]),
        names,
      }),
    ).rejects.toThrow('not ready');
  });
});
