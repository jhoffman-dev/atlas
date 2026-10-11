/**
 * P30-03 (integration): the local API's side of checklists, through the real
 * markdown reader and writer — `POST /v1/notes/{path}/promote` makes a line a
 * task as "Make task" does, and a view's or a query's rows carry each note's
 * checklist progress.
 */
import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, encoded, type ApiResponse } from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
  '    done: archive',
  '  completed: date',
  '---',
  '',
].join('\n');

const PLAN = [
  '---',
  'type: task',
  'status: in-progress',
  '---',
  '- [x] Book the hall',
  '- [ ] Order chairs',
  '- [ ] Order chairs',
  '- [ ] Ring Mara Quill',
  '',
].join('\n');

const source = 'tasks/Plan the launch.md';

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    files: { '.atlas/types/task.md': TASK_TYPE, [source]: PLAN, ...files },
    markdown: remarkMarkdown,
  });
}

const promote = (body: Record<string, unknown>, path = source) => ({
  method: 'POST' as const,
  path: `/v1/notes/${encoded(path)}/promote`,
  body,
});

const noteOf = (response: ApiResponse, key: 'note' | 'task') =>
  bodyOf(response)[key] as { path: string; body: string; properties: Record<string, unknown> };

describe('POST /v1/notes/{path}/promote', () => {
  it('makes the line a task beside its note, linked both ways, and answers both', async () => {
    const api = vault();
    const response = await api.send(promote({ text: 'Ring Mara Quill' }));
    expect(response.status).toBe(201);
    const task = noteOf(response, 'task');
    expect(task.path).toBe('tasks/Ring Mara Quill.md');
    expect(task.properties).toMatchObject({ type: 'task', status: 'inbox' });
    expect(String(task.properties['source'])).toMatch(/^\[\[Plan the launch#\^[a-z0-9]{6}\]\]$/);
    const id = /\^([a-z0-9]{6})/.exec(String(task.properties['source']))?.[1] ?? '';
    expect(api.files.get(source)?.text).toBe(
      PLAN.replace('- [ ] Ring Mara Quill', `- [ ] [[Ring Mara Quill]] ^${id}`),
    );
    expect(noteOf(response, 'note').body).toContain('[[Ring Mara Quill]]');
  });

  it('finds the vault’s Task type however its name is cased, so the task starts at inbox', async () => {
    const api = vault({ '.atlas/types/task.md': TASK_TYPE.replace('name: task', 'name: Task') });
    const response = await api.send(promote({ text: 'Ring Mara Quill' }));
    expect(response.status).toBe(201);
    expect(noteOf(response, 'task').properties).toMatchObject({ status: 'inbox' });
  });

  it('asks which line, when two say the same, and takes the one named', async () => {
    const api = vault();
    const ambiguous = await api.send(promote({ text: 'Order chairs' }));
    expect(codeOf(ambiguous)).toBe('invalid');
    expect(api.writes).toEqual([]);
    const response = await api.send(promote({ text: 'Order chairs', line: 2 }));
    expect(response.status).toBe(201);
    expect(api.files.get(source)?.text).toMatch(
      /- \[ \] Order chairs\n- \[ \] \[\[Order chairs\]\] \^[a-z0-9]{6}\n/,
    );
  });

  it('refuses a line that is not there, or not the one named, writing nothing', async () => {
    const api = vault();
    expect(codeOf(await api.send(promote({ text: 'Order tables' })))).toBe('not_found');
    expect(codeOf(await api.send(promote({ text: 'Order chairs', line: 0 })))).toBe('invalid');
    expect(codeOf(await api.send(promote({ text: '' })))).toBe('invalid');
    expect(api.writes).toEqual([]);
  });

  it('answers exists for a line that is a task already, writing nothing', async () => {
    const api = vault();
    expect((await api.send(promote({ text: 'Ring Mara Quill' }))).status).toBe(201);
    const writes = api.writes.length;
    const again = await api.send(promote({ text: 'Ring Mara Quill' }));
    expect(codeOf(again)).toBe('exists');
    expect(JSON.stringify(bodyOf(again))).toContain('is the task “Ring Mara Quill” already');
    expect(api.writes).toHaveLength(writes);
  });

  it('finds a line by its markdown — emphasis, code and links as written — as well as its words', async () => {
    const api = vault({ 'tasks/Rich.md': '- [ ] Ring **Mara** about `hall.md` and [[Launch]]\n' });
    const markdown = await api.send(
      promote({ text: 'Ring **Mara** about `hall.md` and [[Launch]]' }, 'tasks/Rich.md'),
    );
    expect(markdown.status).toBe(201);
    const api2 = vault({ 'tasks/Rich.md': '- [ ] Ring **Mara** about `hall.md` and [[Launch]]\n' });
    const words = await api2.send(
      promote({ text: 'Ring Mara about hall.md and Launch' }, 'tasks/Rich.md'),
    );
    expect(words.status).toBe(201);
  });

  it('refuses a note Atlas holds unsaved typing in', async () => {
    const api = vault();
    api.deps = { ...api.deps, openNotes: { ...api.deps.openNotes, state: () => 'dirty' } };
    expect(codeOf(await api.send(promote({ text: 'Ring Mara Quill' })))).toBe('unsaved_in_app');
    expect(api.writes).toEqual([]);
  });
});

describe('checklist progress in the API’s rows', () => {
  it('is a column of a query over a type that has it', async () => {
    const api = vault();
    // The index here is a stand-in: what is held is that the query asks for the column.
    const response = await api.send({
      method: 'POST',
      path: '/v1/query',
      body: { type: 'task', columns: ['status'] },
    });
    expect(String(bodyOf(response)['sql'])).toContain('"progress"');
  });

  it('is left to a type that declares a progress of its own', async () => {
    const api = vault({
      '.atlas/types/goal.md': '---\nname: goal\nproperties:\n  progress: number\n---\n',
    });
    const response = await api.send({
      method: 'POST',
      path: '/v1/query',
      body: { type: 'goal', columns: [] },
    });
    expect(String(bodyOf(response)['sql'])).not.toContain('"progress"');
  });

  it('is a column of a saved view’s rows', async () => {
    const api = vault({
      '.atlas/views/Tasks.md':
        '---\natlas: view\ntype: task\nlayout: table\ncolumns: [status]\n---\n',
    });
    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/views/Tasks.md')}/run`,
    });
    expect(String(bodyOf(response)['sql'])).toContain('"progress"');
  });
});
