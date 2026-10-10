/**
 * Adversarial pass, round 2, on P30-02 (ADR-0029): the Waiting rule judges a
 * status exactly as written, while the index — and so the Waiting view, the
 * board's columns and the Inbox's quick look — reads it trimmed, one row per
 * item of a list. A status the index reads as `waiting` must be held to the
 * rule as `waiting`. (The list spelling is in the domain's round-2 file: this
 * fixture's markdown writes a list as one line, which hides it.)
 */
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '@atlas/domain';
import { apiFixture, codeOf } from '../testing/api-fixture.ts';
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

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    files: { '.atlas/types/task.md': GTD_TASK_TYPE, ...files },
  });
}

/** What the index stores as a note's status: the text `status = waiting` is compared with. */
const indexedStatuses = (status: unknown) =>
  indexablePropertiesOf({ status })
    .filter((row) => row.key === 'status')
    .map((row) => row.text);

describe('a status the index reads as Waiting, written another way', () => {
  it('is read by the index as `waiting`, so the Waiting view lists it', () => {
    // The premise of the test below: the spelling lands in the Waiting view.
    expect(indexedStatuses('waiting ')).toEqual(['waiting']);
  });

  it('refuses moving a task to `waiting ` (trailing space) with nobody to wait on', async () => {
    const TASK = jsonNote({ type: 'task', status: 'next-action' });
    const api = vault({ 'Quote from Larkspur.md': TASK });
    const response = await api.send({
      method: 'PATCH',
      path: '/v1/notes/Quote from Larkspur.md/properties',
      body: { set: { status: 'waiting ' } },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(api.files.get('Quote from Larkspur.md')?.text).toBe(TASK);
  });
});
