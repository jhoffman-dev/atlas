/**
 * Adversarial pass on P30-02 (ADR-0029): "the rules hold everywhere a task is
 * written". These are API writes that make or change a task without going
 * through `withTaskRules`, each leaving a task the rules forbid.
 */
import { describe, expect, it } from 'vitest';
import { apiFixture, codeOf, encoded, TODAY } from '../testing/api-fixture.ts';
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
  it('refuses a new task that is Waiting with nobody to wait on', async () => {
    const api = vault();
    const response = await api.send({
      method: 'POST',
      path: '/v1/notes',
      body: { name: 'Hear back from Tobias', properties: { type: 'task', status: 'waiting' } },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(api.files.has('Hear back from Tobias.md')).toBe(false);
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
  it('refuses a card added to the Waiting column with nobody to wait on', async () => {
    const api = vault();
    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/views/By status.md')}/notes`,
      body: { group: 'waiting', name: 'Quote from Larkspur' },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(api.files.has('Quote from Larkspur.md')).toBe(false);
  });
});

describe('PATCH /v1/notes/{path}/properties changing the type in the same call', () => {
  it('refuses turning a note that says Waiting into a task with nobody to wait on', async () => {
    const NOTE = '---\n{"type":"note","status":"waiting"}\n---\n\n# Reply\n';
    const api = vault({ 'Reply.md': NOTE });
    const response = await api.send({
      method: 'PATCH',
      path: '/v1/notes/Reply.md/properties',
      body: { set: { type: 'task' } },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(api.files.get('Reply.md')?.text).toBe(NOTE);
  });
});
