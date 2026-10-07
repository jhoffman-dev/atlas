/**
 * Adversarial pass on issue #6's write routes: POST /v1/views/{path}/move and
 * POST /v1/views/{path}/notes. Each test names one invariant the routes, their
 * doc (vault/docs/api/v1.md, "Groups, boards and + New") or the board itself
 * promise, and shows a request that breaks it.
 */

import { describe, expect, it } from 'vitest';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const TASK = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['todo', 'doing', 'done'] },
    points: 'number',
    flagged: 'checkbox',
    project: { kind: 'relation', target: 'project' },
  },
});

const view = (display: Record<string, unknown>) =>
  jsonNote({ atlas: 'view', type: 'task', columns: ['title'], ...display });

const WEEKLY =
  '---\ntype: task\nstatus: doing\ndue: 2026-01-05\nrecurrence: every week\n---\n\nbody\n';

/** jsonMarkdown, remembering every set of changes written over an existing note's frontmatter. */
function recordingMarkdown(): MarkdownPort & { changed: Record<string, unknown>[] } {
  const base = jsonMarkdown();
  const changed: Record<string, unknown>[] = [];
  return {
    ...base,
    changed,
    updateFrontmatter: (frontmatter, changes) => {
      if (frontmatter !== null) changed.push({ ...changes });
      return base.updateFrontmatter(frontmatter, changes);
    },
  };
}

/**
 * The index as the board reads it: one note already at 3 points, so 3 is one
 * of the Points board's columns (a number declares none of its own).
 */
const INDEX: Partial<IndexPort> = {
  query: async (text) =>
    text.includes('graph:')
      ? { columns: [], rows: [], truncated: false }
      : { columns: ['path', 'title', 'points'], rows: [['Big.md', 'Big', 3]], truncated: false },
};

function vault(files: Record<string, string> = {}) {
  const markdown = recordingMarkdown();
  const api = apiFixture({
    markdown,
    index: INDEX,
    files: {
      '.atlas/types/task.md': TASK,
      '.atlas/views/Status.md': view({ layout: 'board', groupBy: 'status' }),
      '.atlas/views/Points.md': view({ layout: 'board', groupBy: 'points' }),
      '.atlas/views/Flagged.md': view({ layout: 'board', groupBy: 'flagged' }),
      '.atlas/views/Projects.md': view({ layout: 'board', groupBy: 'project' }),
      '.atlas/views/Table.md': view({ layout: 'table', groupBy: 'status' }),
      'Weekly.md': WEEKLY,
      ...files,
    },
  });
  return { api, markdown };
}

type Api = ReturnType<typeof vault>['api'];

const move = (api: Api, board: string, body: unknown) =>
  api.send({ method: 'POST', path: `/v1/views/${encoded(board)}/move`, body });

const add = (api: Api, at: string, body: unknown) =>
  api.send({ method: 'POST', path: `/v1/views/${encoded(at)}/notes`, body });

const textOf = (api: Api, path: string) => api.files.get(path)?.text ?? '';

describe('POST /v1/views/{path}/move: what a card is written', () => {
  it('refuses a group that is not one of the column property options, writing nothing', async () => {
    // "Done" for "done" is the mistake an agent makes; the doc says a group is
    // "a group's value as a run answers it", and no run answers "Done".
    const { api } = vault();

    const response = await move(api, '.atlas/views/Status.md', {
      note: 'Weekly.md',
      group: 'Done',
    });

    expect(codeOf(response)).toBe('invalid');
    expect(textOf(api, 'Weekly.md')).toBe(WEEKLY);
  });

  it('never leaves a card in the done column unfinished, however the group is spaced', async () => {
    // The board's columns trim a value (group-rows.ts `trimmedOrNull`), so
    // " done" sits in the done column; cardMoveChanges compares it untrimmed,
    // so the repeating task is neither finished nor rolled forward.
    const { api } = vault();

    const response = await move(api, '.atlas/views/Status.md', {
      note: 'Weekly.md',
      group: ' done',
    });

    // Either refused, or finished as a drop into "done" is: rolled forward a week.
    const text = textOf(api, 'Weekly.md');
    expect(response.status === 400 || text.includes('due: 2026-01-12')).toBe(true);
  });

  it('writes a number column as a number, as "+ New" in that column does', async () => {
    const { api, markdown } = vault({ 'Sized.md': '---\ntype: task\npoints: 2\n---\n' });

    await move(api, '.atlas/views/Points.md', { note: 'Sized.md', group: '3' });

    expect(markdown.changed).toEqual([{ points: 3 }]);
  });

  it('writes the ticked column of a checkbox board as true, not the string "true"', async () => {
    const { api, markdown } = vault({ 'Plain.md': '---\ntype: task\nstatus: todo\n---\n' });

    await move(api, '.atlas/views/Flagged.md', { note: 'Plain.md', group: 'true' });

    expect(markdown.changed).toEqual([{ flagged: true }]);
  });
});

describe('POST /v1/views/{path}/move: a card already in its group is not written', () => {
  it('leaves a note with no box alone when moved into the unticked column it is already in', async () => {
    // checkboxColumns puts every note whose box is not ticked — one with no box
    // too (ADR-0019) — in "false"; the move compares raw values and writes a
    // `flagged: false` nobody chose.
    const plain = '---\ntype: task\nstatus: todo\n---\n';
    const { api } = vault({ 'Plain.md': plain });

    const response = await move(api, '.atlas/views/Flagged.md', {
      note: 'Plain.md',
      group: 'false',
    });

    expect(bodyOf(response)['moved']).toBe(false);
    expect(textOf(api, 'Plain.md')).toBe(plain);
  });

  it("leaves a relation alone when the card is already in that note's column, however the link is spelled", async () => {
    // group-rows.ts keys a relation by the note's name, so [[atlas]] and
    // [[Projects/Atlas]] sit in the [[Atlas]] column; the move compares text.
    const linked = '---\ntype: task\nproject: [[Projects/Atlas]]\n---\n';
    const { api } = vault({ 'Linked.md': linked });

    const response = await move(api, '.atlas/views/Projects.md', {
      note: 'Linked.md',
      group: '[[Atlas]]',
    });

    expect(bodyOf(response)['moved']).toBe(false);
    expect(api.writes.filter((write) => write.path === 'Linked.md')).toHaveLength(0);
  });

  it('does not finish a repeating task twice when the same move is sent twice', async () => {
    // The doc: "a finished task is never finished twice". The first move rolls
    // Weekly back to todo, so a retry of the identical request finishes it again.
    // A move that finishes a task carries the `ifModified` it was read at
    // (review finding 1), so the retry is refused as stale, not applied again.
    const { api } = vault();
    const read = await api.send({ method: 'GET', path: `/v1/notes/${encoded('Weekly.md')}` });
    const modified = (bodyOf(read)['note'] as { modified: number }).modified;
    const request = { note: 'Weekly.md', group: 'done', ifModified: modified };

    await move(api, '.atlas/views/Status.md', request);
    const retry = await move(api, '.atlas/views/Status.md', request);

    expect(codeOf(retry)).toBe('conflict');
    expect(textOf(api, 'Weekly.md')).toContain('due: 2026-01-12');
  });
});

describe('POST /v1/views/{path}/move: the view is never written', () => {
  it('refuses to move a view note that lists the type, as if it were a card of it', async () => {
    // A view's own `type:` says what it lists, not what it is; the type check
    // reads it as the latter and writes the column into the view.
    const mine = view({ layout: 'board', groupBy: 'status' });
    const { api } = vault({ 'Views/Mine.md': mine });

    const response = await move(api, 'Views/Mine.md', { note: 'Views/Mine.md', group: 'done' });

    expect(codeOf(response)).toBe('invalid');
    expect(textOf(api, 'Views/Mine.md')).toBe(mine);
  });
});

describe('POST /v1/views/{path}/notes: the note it makes', () => {
  it('makes a .md note the API can read back, never a .markdown file', async () => {
    // POST /v1/notes refuses this name (namedPath → isApiNotePath); this route does not.
    const { api } = vault();

    const response = await add(api, '.atlas/views/Table.md', { name: 'Plan.markdown' });

    const made = (bodyOf(response)['note'] as { path?: string } | undefined)?.path ?? '';
    const readBack = await api.send({ method: 'GET', path: `/v1/notes/${encoded(made)}` });
    expect(response.status === 400 || readBack.status === 200).toBe(true);
    expect([...api.files.keys()].some((path) => path.endsWith('.markdown'))).toBe(false);
  });

  it('numbers every one of five "+ New" added at once, failing none', async () => {
    // createNote gives up after three names taken between listing and creating
    // and the error escapes as a bare 500 `internal`.
    const { api } = vault();

    const answers = await Promise.all(
      [1, 2, 3, 4, 5].map(() => add(api, '.atlas/views/Table.md', { group: 'todo' })),
    );

    expect(answers.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201]);
  });
});
