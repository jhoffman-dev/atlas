import { describe, expect, it } from 'vitest';
import { parseObjectType } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { AtlasQueryError, runAtlasQuery } from './run-atlas-query.ts';

const TYPES = [
  parseObjectType({
    name: 'task',
    properties: {
      status: { kind: 'select', options: ['doing', 'done'] },
      owner: { kind: 'relation', target: 'person' },
    },
  }),
  parseObjectType({ name: 'person', properties: {} }),
];

const NOTES = ['people/Julie.md', 'tasks/A.md'];

function recordingIndex() {
  const asked: { sql: string; parameters: readonly unknown[] }[] = [];
  const index = fakeIndexPort({
    query: async (sql, parameters) => {
      asked.push({ sql, parameters });
      return {
        columns: ['path', 'title', 'type'],
        rows: [['tasks/A.md', 'A', 'task']],
        truncated: false,
      };
    },
  });
  return { index, asked };
}

describe('runAtlasQuery', () => {
  it('asks the index for the rows fetchLimit says, keeping the text’s own LIMIT in the query', async () => {
    const { index, asked } = recordingIndex();
    const seen: (number | null)[] = [];
    const answer = await runAtlasQuery({
      index,
      text: 'FROM task LIMIT 7',
      types: TYPES,
      notePaths: NOTES,
      fetchLimit: (textLimit) => {
        seen.push(textLimit);
        return 8;
      },
    });
    expect(seen).toEqual([7]);
    expect(asked[0]?.parameters.at(-1)).toBe(8);
    expect(answer.query.limit).toBe(7);
  });

  it('runs the compiled statement and hands back its rows, the SQL and the query', async () => {
    const { index, asked } = recordingIndex();
    const answer = await runAtlasQuery({
      index,
      text: 'FROM task WHERE status = doing GROUP BY status',
      types: TYPES,
      notePaths: NOTES,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.sql.startsWith('/* atlas-query */')).toBe(true);
    expect(answer.result.rows).toEqual([['tasks/A.md', 'A', 'task']]);
    expect(answer.result.sql).toBe(asked[0]?.sql);
    expect(answer.compiled.groups.map((field) => field.text)).toEqual(['status']);
    expect(answer.query.from.map((name) => name.text)).toEqual(['task']);
  });

  it('resolves a link in the query to the note it names, however it is cased', async () => {
    const { index, asked } = recordingIndex();
    await runAtlasQuery({
      index,
      text: 'FROM task WHERE owner = [[julie]]',
      types: TYPES,
      notePaths: NOTES,
    });
    expect(asked[0]?.parameters).toContain('people/Julie.md');
  });

  it('points at the problem in the text, without asking the index anything', async () => {
    const { index, asked } = recordingIndex();
    const attempt = runAtlasQuery({
      index,
      text: 'FROM task WHERE stauts = x',
      types: TYPES,
      notePaths: NOTES,
    });
    await expect(attempt).rejects.toBeInstanceOf(AtlasQueryError);
    await expect(attempt).rejects.toMatchObject({
      message: 'A task has no field called stauts.',
      problem: { span: { start: 16, end: 22 } },
    });
    expect(asked).toEqual([]);
  });

  it('passes on the index’s failure in its own words, without the machine’s paths', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('no such table: relations in /Users/james/Vault/.atlas-cache/index.sqlite');
      },
    });
    const attempt = runAtlasQuery({ index, text: 'FROM task', types: TYPES, notePaths: NOTES });
    await expect(attempt).rejects.toMatchObject({
      message: 'no such table: relations in <path>',
      problem: null,
    });
  });
});
