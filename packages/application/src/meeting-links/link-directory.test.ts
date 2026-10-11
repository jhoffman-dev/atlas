import { describe, expect, it } from 'vitest';
import { LINK_DIRECTORY_PAGE_SIZE } from '@atlas/domain';
import type { QueryResult } from '../index/ports.ts';
import { loadLinkDirectory, loadProjectTies } from './link-directory.ts';
import { vaultPath } from '../testing/proposal-vault.ts';

const COLUMNS = ['path', 'title', 'type', 'key', 'value'];

describe('loadLinkDirectory', () => {
  it('reads every page while the host says there is more, a blank title and empty cells as none', async () => {
    const pages: QueryResult[] = [
      {
        columns: COLUMNS,
        rows: [['People/Mara Quill.md', null, 'person', 'email', 'mara@larkspur.example']],
        truncated: true,
      },
      {
        columns: COLUMNS,
        rows: [['People/Mara Quill.md', 'Mara Quill', undefined, null, null]],
        truncated: false,
      },
    ];
    const asked: unknown[][] = [];
    const index = {
      query: async (_sql: string, parameters: readonly (string | number | null)[]) => {
        asked.push([...parameters]);
        return pages[asked.length - 1] as QueryResult;
      },
    };
    expect(await loadLinkDirectory({ index })).toEqual({
      people: [
        {
          path: 'People/Mara Quill.md',
          name: '',
          emails: ['mara@larkspur.example'],
          aliases: [],
          company: null,
        },
      ],
      companies: [],
    });
    expect(asked.map((parameters) => parameters.at(-1))).toEqual([0, LINK_DIRECTORY_PAGE_SIZE]);
  });
});

describe('loadProjectTies', () => {
  it('asks nothing without people or companies, and reads a blank title as empty', async () => {
    const index = {
      query: async (): Promise<QueryResult> => ({
        columns: ['project', 'title', 'entity'],
        rows: [['Projects/Ledger.md', null, 'People/Mara Quill.md']],
        truncated: false,
      }),
    };
    const meeting = vaultPath('Inbox/Meetings/M.md');
    expect(await loadProjectTies({ index, meeting, entities: [] })).toEqual([]);
    expect(
      await loadProjectTies({ index, meeting, entities: [vaultPath('People/Mara Quill.md')] }),
    ).toEqual([{ project: 'Projects/Ledger.md', title: '', entity: 'People/Mara Quill.md' }]);
  });
});
