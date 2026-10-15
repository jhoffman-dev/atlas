/**
 * Adversarial pass on P30-02 (ADR-0029): "the rules hold everywhere a task is
 * written". These are API writes that make or change a task without going
 * through `withTaskRules`. Since #202 Waiting never needs anyone to wait on,
 * so each of them makes or leaves a Waiting task with nobody, as asked.
 */
import { describe, expect, it } from 'vitest';
import { apiFixture, encoded, TODAY } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const GTD_TASK_TYPE = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: {
      kind: 'select',
      options: [
        'inbox',
        'backlog',
        'next-action',
        'in-progress',
        'waiting',
        'someday',
        'longterm',
        'archive',
      ],
      done: 'archive',
    },
    waiting_on: { kind: 'relation', target: 'person' },
    completed: 'date',
  },
});

const BY_STATUS = jsonNote({ atlas: 'view', type: 'task', layout: 'board', groupBy: 'status' });

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    files: {
      '.atlas/types/task.md': GTD_TASK_TYPE,
      '.atlas/views/By status.md': BY_STATUS,
      ...files,
    },
  });
}

describe('POST /v1/notes making a task', () => {
  it('makes a new task that is Waiting with nobody to wait on', async () => {
    const api = vault();
    const response = await api.send({
      method: 'POST',
      path: '/v1/notes',
      body: { name: 'Hear back from Tobias', properties: { type: 'task', status: 'waiting' } },
    });
    expect(response.status).toBe(201);
    expect(api.files.get('Hear back from Tobias.md')?.text).toContain('status: waiting');
  });

  it('dates a new task made already in Archive', async () => {
    const api = vault();
    await api.send({
      method: 'POST',
      path: '/v1/notes',
      body: { name: 'Filed the forms', properties: { type: 'task', status: 'archive' } },
    });
    expect(api.files.get('Filed the forms.md')?.text).toContain('status: archive');
    expect(api.files.get('Filed the forms.md')?.text).toContain(`completed: ${TODAY}`);
  });
});

describe('POST /v1/views/{path}/notes adding a card to a status column', () => {
  it('adds a card to the Waiting column with nobody to wait on', async () => {
    const api = vault();
    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/views/By status.md')}/notes`,
      body: { group: 'waiting', name: 'Quote from Larkspur' },
    });
    expect(response.status).toBe(201);
    expect(api.files.get('Quote from Larkspur.md')?.text).toContain('status: waiting');
  });
});

describe('POST /v1/views/{path}/move dropping a card into the Waiting column', () => {
  it('moves the task to Waiting with nobody to wait on, asking for no one (#202)', async () => {
    const TASK = jsonNote({ type: 'task', status: 'next-action' });
    const api = vault({ 'Call the bank.md': TASK });
    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/views/By status.md')}/move`,
      body: { note: 'Call the bank.md', group: 'waiting' },
    });
    expect(response.status).toBe(200);
    expect(api.files.get('Call the bank.md')?.text).toContain('status: waiting');
  });
});

describe('PATCH /v1/notes/{path}/properties changing the type in the same call', () => {
  it('turns a note that says Waiting into a task with nobody to wait on', async () => {
    const NOTE = '---\n{"type":"note","status":"waiting"}\n---\n\n# Reply\n';
    const api = vault({ 'Reply.md': NOTE });
    const response = await api.send({
      method: 'PATCH',
      path: '/v1/notes/Reply.md/properties',
      body: { set: { type: 'task' } },
    });
    expect(response.status).toBe(200);
    expect(api.files.get('Reply.md')?.text).toContain('type: task');
  });
});
