/**
 * Adversarial pass on #112: `POST /v1/inbox/clarify` handed what a careless or
 * hostile caller sends. Whatever it is, the answer is `invalid` and the vault
 * is as it was.
 */
import { describe, expect, it } from 'vitest';
import { apiFixture, codeOf } from '../testing/api-fixture.ts';

const PROJECT = '---\ntype: project\n---\n\nThe payroll run.\n';
const PERSON = '---\ntype: person\n---\n\nA colleague.\n';
const CAPTURED = '---\ntype: task\nstatus: inbox\n---\n\nAbout the lease.\n';
const FILES = {
  'Projects/Larkspur Payroll.md': PROJECT,
  'People/Mara Quill.md': PERSON,
  'Inbox/Call Tobias Fenn.md': CAPTURED,
  'Inbox/Idea.md': 'Just words.\n',
  'Inbox/pic.png': 'png',
  'Inbox/.hidden/Secret.md': CAPTURED,
  'Tasks/Imported.md': CAPTURED,
  'Tasks/Doing.md': '---\ntype: task\nstatus: in-progress\n---\n',
  'Notes/Diary.md': 'Dear diary.\n',
  'Archive/Tasks/Old.md': '---\ntype: task\nstatus: archive\ncompleted: 2026-01-02\n---\n',
  'Archive/People/Gone.md': PERSON,
  '.atlas/types/person.md': PERSON,
  '.atlas/types/task.md': '---\ntype: task\nstatus: inbox\n---\n',
  '.atlas/templates/Task.md': '---\ntype: task\n---\n',
};
const T = 'Inbox/Call Tobias Fenn.md';
const HOSTILE: [string, unknown][] = [
  ['a path that climbs out of the vault', { path: '../outside.md', status: 'backlog' }],
  ['a path that climbs out from inside', { path: 'Inbox/../../outside.md', status: 'backlog' }],
  ['an absolute path', { path: '/etc/hosts.md', status: 'backlog' }],
  ['a path with backslashes', { path: 'Inbox\\Call Tobias Fenn.md', status: 'backlog' }],
  ['a path with a null byte', { path: 'Inbox/Call\u0000.md', status: 'backlog' }],
  ['an empty path', { path: '', status: 'backlog' }],
  ['a path that is a number', { path: 5, status: 'backlog' }],
  ['a path that is a list', { path: [T], status: 'backlog' }],
  ['a null path', { path: null, status: 'backlog' }],
  ['no path', { status: 'backlog' }],
  ['one of Atlas’s own type files', { path: '.atlas/types/task.md', status: 'backlog' }],
  ['a template (ADR-0026)', { path: '.atlas/templates/Task.md', status: 'backlog' }],
  ['a template, in another case', { path: '.ATLAS/Templates/Task.md', status: 'backlog' }],
  ['a note in a hidden folder', { path: 'Inbox/.hidden/Secret.md', status: 'backlog' }],
  ['a file that is not a note', { path: 'Inbox/pic.png', project: 'Projects/Larkspur Payroll.md' }],
  ['a folder', { path: 'Inbox', status: 'backlog' }],
  ['a note that is not there', { path: 'Inbox/Nope.md', status: 'backlog' }],
  ['a path of 100,000 characters', { path: `Inbox/${'x'.repeat(100_000)}.md`, status: 'backlog' }],
  ['a status that is a number', { path: T, status: 5 }],
  ['a null status', { path: T, status: null }],
  ['an empty status', { path: T, status: '' }],
  ['a status that is not one of the eight', { path: T, status: 'done' }],
  ['a status in another case', { path: T, status: 'Next-Action' }],
  ['a status of a million characters', { path: T, status: 'x'.repeat(1_000_000) }],
  ['a defer that is a number', { path: T, defer: 20261020 }],
  ['an empty defer', { path: T, defer: '' }],
  ['a defer in words', { path: T, defer: 'tomorrow' }],
  ['a defer that is no day of the calendar', { path: T, defer: '2026-02-30' }],
  ['a due with a space before it', { path: T, due: ' 2026-10-20' }],
  ['contexts that are not a list', { path: T, contexts: '@home' }],
  ['contexts that are not strings', { path: T, contexts: [1] }],
  ['null contexts', { path: T, contexts: null }],
  ['asTask that is not a boolean', { path: T, asTask: 'yes' }],
  ['nothing chosen', { path: T }],
  ['only a field it does not know', { path: T, statuz: 'backlog' }],
  [
    'waiting on one of Atlas’s own files',
    { path: T, status: 'waiting', waitingOn: '.atlas/types/person.md' },
  ],
  [
    'waiting on an archived person',
    { path: T, status: 'waiting', waitingOn: 'Archive/People/Gone.md' },
  ],
  [
    'waiting on a path that climbs out',
    { path: T, status: 'waiting', waitingOn: '../People/Mara Quill.md' },
  ],
  ['waiting on itself', { path: T, status: 'waiting', waitingOn: T }],
  ['waiting on an empty path', { path: T, status: 'waiting', waitingOn: '' }],
  ['waiting on nobody, said as null', { path: T, status: 'waiting', waitingOn: null }],
  ['a null project', { path: T, project: null }],
  ['a project path that climbs out', { path: T, project: '../Projects/Larkspur Payroll.md' }],
  ['itself as its project', { path: T, project: T }],
  ['a project made a task', { path: 'Projects/Larkspur Payroll.md', asTask: true }],
  ['a status for a person', { path: 'People/Mara Quill.md', status: 'backlog' }],
  ['a body that is a list', [1, 2]],
  ['a body that is a string', 'hello'],
  ['a null body', null],
  [
    'a status smuggled in as __proto__',
    JSON.parse('{"path":"Inbox/Call Tobias Fenn.md","__proto__":{"status":"backlog"}}'),
  ],
];

describe('POST /v1/inbox/clarify — hostile bodies', () => {
  it.each(HOSTILE)('answers invalid and writes nothing: %s', async (_name, body) => {
    const api = apiFixture({ files: FILES });
    const before = Object.fromEntries([...api.files].map(([at, note]) => [at, note.text]));

    const response = await api.send({ method: 'POST', path: '/v1/inbox/clarify', body });

    expect(codeOf(response)).toBe('invalid');
    expect(Object.fromEntries([...api.files].map(([at, note]) => [at, note.text]))).toEqual(before);
    expect(api.writes).toEqual([]);
  });

  it('does not hand a million-character status back in its answer', async () => {
    const api = apiFixture({ files: FILES });
    const response = await api.send({
      method: 'POST',
      path: '/v1/inbox/clarify',
      body: { path: T, status: 'x'.repeat(1_000_000) },
    });
    expect(JSON.stringify(response.body).length).toBeLessThan(10_000);
  });
});
