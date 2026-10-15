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
      keys: ['project', 'status'],
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
      keys: ['tags'],
    });
    expect(tagged.tags).toEqual(['errand', 'Q3']);

    queries.length = 0;
    const untagged = await loadFilterChoiceSources({
      index,
      type: taskType([property('status', 'select')]),
      names,
      keys: ['status'],
    });
    expect(untagged).toEqual({ tags: [], related: {} });
    expect(queries).toEqual([]);
  });

  it('reads nothing for a property not asked about', async () => {
    const asked: string[] = [];
    const sources = await loadFilterChoiceSources({
      index: fakeIndexPort({
        notesOfType: async (type) => {
          asked.push(type);
          return [];
        },
        query: async (sql) => {
          asked.push(sql);
          return { columns: [], rows: [], truncated: false };
        },
      }),
      type: taskType([
        property('project', 'relation', 'project'),
        property('tags', 'multiSelect'),
        property('status', 'select'),
      ]),
      names,
      keys: ['status'],
    });
    expect(sources).toEqual({ tags: [], related: {} });
    expect(asked).toEqual([]);
  });

  it('fails as the index fails, so the caller decides what to offer instead', async () => {
    await expect(
      loadFilterChoiceSources({
        index: fakeIndexPort({ notesOfType: () => Promise.reject(new Error('not ready')) }),
        type: taskType([property('project', 'relation', 'project')]),
        names,
        keys: ['project'],
      }),
    ).rejects.toThrow('not ready');
  });
});

/*
 * The relation's notes are offered when a Filter value box opens, on the
 * renderer's main thread, and again on every index change while it is in use;
 * the NoteNames they are linked and named with is made again whenever the
 * vault graph changes, so nothing it resolved is kept. Each note must be
 * linked and named without searching the whole vault (#212).
 */
describe('loadFilterChoiceSources in a 5,000-note vault', () => {
  const VAULT = 5000;
  const PROJECTS = 200;
  /** Generous: a frame is 16 ms. */
  const BUDGET_MS = 250;

  const notes = Array.from({ length: VAULT }, (_, at) =>
    at < PROJECTS
      ? { path: `projects/Project ${at}.md`, title: `Project ${at}` }
      : { path: `notes/Note ${at}.md`, title: `Note ${at}` },
  );

  it(`offers ${PROJECTS} projects within ${BUDGET_MS} ms`, { timeout: 120_000 }, async () => {
    // A fresh NoteNames, as app.tsx makes after any change to the vault graph.
    const fresh = noteNames(notes.map((note) => ({ ...note, path: createVaultPath(note.path) })));
    const index = fakeIndexPort({
      notesOfType: async (type) => (type === 'project' ? notes.slice(0, PROJECTS) : []),
    });

    const started = performance.now();
    const sources = await loadFilterChoiceSources({
      index,
      type: taskType([property('project', 'relation', 'project')]),
      names: fresh,
      keys: ['project'],
    });
    const took = performance.now() - started;

    expect(sources.related['project']).toHaveLength(PROJECTS);
    expect(Math.round(took)).toBeLessThan(BUDGET_MS);
  });
});
