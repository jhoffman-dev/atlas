import { describe, expect, it } from 'vitest';
import { parseObjectType } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { AtlasQueryError } from './run-atlas-query.ts';
import { runQueryBlock } from './run-query-block.ts';

const TYPES = [
  parseObjectType({
    name: 'meeting',
    properties: { people: { kind: 'relation', target: 'person', many: true } },
  }),
  parseObjectType({ name: 'person', properties: {} }),
];

const NOTES = ['people/Mara Quill.md', 'meetings/Kickoff.md'];
const MARA = 'people/Mara Quill.md';

function recordingIndex() {
  const asked: { sql: string; parameters: readonly unknown[] }[] = [];
  const index = fakeIndexPort({
    query: async (sql, parameters) => {
      asked.push({ sql, parameters });
      return {
        columns: ['path', 'title', 'type'],
        rows: [['meetings/Kickoff.md', 'Kickoff', 'meeting']],
        truncated: false,
      };
    },
  });
  return { index, asked };
}

describe('runQueryBlock', () => {
  it('runs the query with this naming the note the block is in', async () => {
    const { index, asked } = recordingIndex();
    const found = await runQueryBlock({
      index,
      text: 'FROM meeting WHERE people = this',
      types: TYPES,
      notePaths: NOTES,
      notePath: MARA,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.parameters).toContain(MARA);
    expect(found.layout).toBe('table');
    expect(found.answer.result.rows).toEqual([['meetings/Kickoff.md', 'Kickoff', 'meeting']]);
  });

  it('draws the layout its first line says, and runs only the query after it', async () => {
    const { index, asked } = recordingIndex();
    const found = await runQueryBlock({
      index,
      text: 'layout: list\nFROM meeting WHERE people = this',
      types: TYPES,
      notePaths: NOTES,
      notePath: MARA,
    });
    expect(found.layout).toBe('list');
    expect(found.answer.query.from.map((name) => name.text)).toEqual(['meeting']);
    expect(asked).toHaveLength(1);
  });

  it('refuses a layout it cannot draw as a problem in the text, asking the index nothing', async () => {
    const { index, asked } = recordingIndex();
    const attempt = runQueryBlock({
      index,
      text: 'layout: board\nFROM meeting',
      types: TYPES,
      notePaths: NOTES,
      notePath: MARA,
    });
    await expect(attempt).rejects.toBeInstanceOf(AtlasQueryError);
    await expect(attempt).rejects.toMatchObject({
      message: 'A query block shows a table or a list; “board” is neither.',
      problem: { message: 'A query block shows a table or a list; “board” is neither.' },
    });
    expect(asked).toEqual([]);
  });

  it('passes on a problem in the query itself', async () => {
    const { index, asked } = recordingIndex();
    const attempt = runQueryBlock({
      index,
      text: 'FROM meeting WHERE stauts = x',
      types: TYPES,
      notePaths: NOTES,
      notePath: MARA,
    });
    await expect(attempt).rejects.toMatchObject({
      message: 'A meeting has no field called stauts.',
    });
    expect(asked).toEqual([]);
  });
});
