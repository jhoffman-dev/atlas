import {
  createVaultPath,
  noteNames,
  parseDashboard,
  parseObjectType,
  queryWidgetDraft,
} from '@dfai/domain';
import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { previewWidget } from './edit-dashboard.ts';
import { runDashboard } from './run-widget.ts';

/**
 * Adversarial (ADR-0019, P24-04): the dashboard editor's preview of a query
 * widget must ask the index what the dashboard itself will ask.
 */

const TYPES = [
  parseObjectType({
    name: 'task',
    properties: { project: { kind: 'relation', target: 'project' } },
  }),
  parseObjectType({ name: 'project', properties: {} }),
];
const NOTE_PATHS = ['projects/DFAI.md', 'tasks/Write.md'];
const QUERY = 'FROM task WHERE project = [[DFAI]]';

function recordingIndex() {
  const asked: unknown[][] = [];
  const index = fakeIndexPort({
    query: async (_sql, parameters) => {
      asked.push([...parameters]);
      return { columns: ['path', 'title', 'type'], rows: [], truncated: false };
    },
  });
  return { index, asked };
}

describe('a query widget previewed while editing (adversarial)', () => {
  it('resolves a link in the query to the note the dashboard resolves it to', async () => {
    // Why: previewWidget runs the widget without the vault's notes, so [[DFAI]]
    // resolves to nothing and is compared as written: a task linking
    // [[projects/DFAI]] shows on the dashboard but not in its preview.
    const dashboard = recordingIndex();
    const widgets = parseDashboard({
      atlas: 'dashboard',
      widgets: [{ kind: 'query', title: 'DFAI', query: QUERY }],
    });
    await runDashboard({ index: dashboard.index, widgets, types: TYPES, notePaths: NOTE_PATHS });
    expect(dashboard.asked[0]).toContain('projects/DFAI.md');

    const preview = recordingIndex();
    // Everything the dashboard is given is on hand to the editor too.
    const args = {
      index: preview.index,
      draft: queryWidgetDraft({ query: QUERY, title: 'DFAI' }),
      types: TYPES,
      notePaths: NOTE_PATHS,
    };
    await previewWidget(args);
    expect(preview.asked[0]).toEqual(dashboard.asked[0]);
  });
});

describe('a query widget grouped by a relation', () => {
  it('names each group for the note it points at, as a query view does', async () => {
    // Why: runWidget grouped the rows with no note names, so a group heading
    // read as the link's bare name rather than the note's title.
    const index = fakeIndexPort({
      query: async () => ({
        columns: ['path', 'title', 'type', 'project'],
        rows: [['tasks/Write.md', 'Write', 'task', '[[projects/DFAI]]']],
        truncated: false,
      }),
    });
    const widgets = parseDashboard({
      atlas: 'dashboard',
      widgets: [{ kind: 'query', title: 'By project', query: 'FROM task GROUP BY project' }],
    });
    const names = noteNames([{ path: createVaultPath('projects/DFAI.md'), title: 'The DFAI app' }]);
    const [result] = await runDashboard({
      index,
      widgets,
      types: TYPES,
      notePaths: NOTE_PATHS,
      names,
    });
    const data = result?.data as unknown as { groups: { label: string }[] };
    expect(data.groups.map((group) => group.label)).toEqual(['The DFAI app']);
  });
});
