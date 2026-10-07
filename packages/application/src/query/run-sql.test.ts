import { describe, expect, it } from 'vitest';
import { DASHBOARD_MARKER, DASHBOARD_MARKER_VALUE, parseDashboard } from '@atlas/domain';
import { runWidget } from '../dashboard/run-widget.ts';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { loadSchema, runSql, SqlQueryError } from './run-sql.ts';

/** An index that records what it was asked and answers from `answer`. */
function recordingIndex(answer: (sql: string) => { columns: string[]; rows: unknown[][] }) {
  const asked: { sql: string; parameters: readonly unknown[] }[] = [];
  const index = fakeIndexPort({
    query: async (sql, parameters) => {
      asked.push({ sql, parameters });
      return { ...answer(sql), truncated: false };
    },
  });
  return { index, asked };
}

describe('runSql', () => {
  it('sends the statement as written, without its trailing semicolon or any parameters', async () => {
    const { index, asked } = recordingIndex(() => ({ columns: ['n'], rows: [[1]] }));
    const result = await runSql({ index, sql: '  SELECT 1 AS n; ' });
    expect(asked).toEqual([{ sql: 'SELECT 1 AS n', parameters: [] }]);
    expect(result.rows).toEqual([[1]]);
  });

  it('asks for a statement rather than sending an empty one', async () => {
    const { index, asked } = recordingIndex(() => ({ columns: [], rows: [] }));
    await expect(runSql({ index, sql: ' ;' })).rejects.toThrow('Write a query to run.');
    expect(asked).toEqual([]);
  });

  it('passes on the index’s refusal in its own words, without the machine’s paths', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error(
          'unable to open /Users/james/Vault/.atlas-cache/index.db: attempt to write',
        );
      },
    });
    const attempt = runSql({ index, sql: 'DELETE FROM files' });
    await expect(attempt).rejects.toThrow(SqlQueryError);
    await expect(attempt).rejects.toThrow('unable to open <path>: attempt to write');
  });
});

describe('loadSchema', () => {
  it('asks the index to describe itself through the same path, and reads the answer', async () => {
    const { index, asked } = recordingIndex(() => ({
      columns: ['table', 'kind', 'column'],
      rows: [
        ['files', 'table', 'path'],
        ['v_task', 'view', 'status'],
      ],
    }));
    const schema = await loadSchema({ index });
    expect(asked[0]?.sql).toContain('sqlite_master');
    expect(schema.map((table) => table.name)).toEqual(['v_task', 'files']);
  });
});

describe('a sql widget', () => {
  const widget = (show: string) =>
    parseDashboard({
      [DASHBOARD_MARKER]: DASHBOARD_MARKER_VALUE,
      widgets: [{ kind: 'sql', sql: 'SELECT status, n FROM counts', show }],
    })[0]!;
  const counts = () => ({
    columns: ['status', 'n'],
    rows: [
      ['doing', 2],
      ['backlog', 6],
    ],
  });

  it('runs its statement and shows the first cell as a number', async () => {
    const { index, asked } = recordingIndex(counts);
    const result = await runWidget({ index, widget: widget('number') });
    expect(asked[0]?.sql).toBe('SELECT status, n FROM counts');
    expect(result.sql).toBe('SELECT status, n FROM counts');
    expect(result.data).toEqual({ shape: 'number', value: 'doing' });
  });

  it('charts the first two columns as bars, in the order the query gave them', async () => {
    const { index } = recordingIndex(counts);
    const result = await runWidget({ index, widget: widget('bar') });
    expect(result.data).toMatchObject({
      shape: 'bars',
      total: 8,
      bars: [
        { label: 'doing', count: 2, share: 25 },
        { label: 'backlog', count: 6, share: 75 },
      ],
    });
  });

  it('lists every row as a table', async () => {
    const { index } = recordingIndex(counts);
    const result = await runWidget({ index, widget: widget('table') });
    expect(result.data).toMatchObject({ shape: 'rows', columns: ['status', 'n'] });
    expect(result.data.shape === 'rows' && result.data.rows[1]?.values).toEqual({
      status: 'backlog',
      n: 6,
    });
  });

  it('is a failed tile, not a failed dashboard, when the index refuses it', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('no such table: counts');
      },
    });
    const result = await runWidget({ index, widget: widget('table') });
    expect(result.data).toEqual({ shape: 'error', message: 'no such table: counts' });
  });
});
