/**
 * Clarifying an Inbox item through the API (#112, ADR-0016's amendment for
 * it): one save of what was decided, held to the task rules, reaching notes
 * only, never saving someone's typing.
 */
import { describe, expect, it } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import { fakeMarkdown } from '../testing/fake-ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const PROJECT = '---\ntype: project\n---\n\nThe app.\n';
const PERSON = '---\ntype: person\n---\n\nA neighbour.\n';
const CAPTURED = '---\ntype: task\nstatus: inbox\n---\n\nAbout the  *lease*.\n';
const FILES = {
  'Projects/Atlas.md': PROJECT,
  'People/Mara Quill.md': PERSON,
  'Inbox/Call Sam.md': CAPTURED,
  'Tasks/Imported.md': '---\ntype: task\nstatus: inbox\n---\n\nFrom Notion.\n',
  '.atlas/types/person.md': PERSON,
};

const clarify = (body: unknown) => ({ method: 'POST' as const, path: '/v1/inbox/clarify', body });

describe('POST /v1/inbox/clarify', () => {
  it('writes status and who it waits on in one save, then files the note, its text untouched', async () => {
    const api = apiFixture({ files: FILES });

    const response = await api.send(
      clarify({
        path: 'Inbox/Call Sam.md',
        status: 'waiting',
        waitingOn: 'People/Mara Quill.md',
        project: 'Projects/Atlas.md',
      }),
    );

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      path: 'Projects/Atlas/Call Sam.md',
      movedFrom: 'Inbox/Call Sam.md',
      failed: [],
      linksUpdated: 0,
    });
    expect(api.files.get('Projects/Atlas/Call Sam.md')?.text).toBe(
      '---\ntype: task\nstatus: waiting\nwaiting_on: [[Mara Quill]]\nproject: [[Atlas]]\n---\n\nAbout the  *lease*.\n',
    );
    expect(api.files.has('Inbox/Call Sam.md')).toBe(false);
  });

  it('gives a task outside the Inbox folder its status, leaving it where it is', async () => {
    const api = apiFixture({ files: FILES });
    const response = await api.send(clarify({ path: 'Tasks/Imported.md', status: 'next-action' }));
    expect(bodyOf(response)).toMatchObject({ path: 'Tasks/Imported.md', movedFrom: null });
    expect(api.files.get('Tasks/Imported.md')?.text).toContain('status: next-action');
  });

  it('refuses Waiting with nobody to wait on as invalid, writing nothing', async () => {
    const api = apiFixture({ files: FILES });
    const response = await api.send(clarify({ path: 'Inbox/Call Sam.md', status: 'waiting' }));
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('needs someone to wait on');
    expect(api.writes).toEqual([]);
    expect(api.files.get('Inbox/Call Sam.md')?.text).toBe(CAPTURED);
  });

  it('clears a date given as null', async () => {
    const api = apiFixture({
      files: { 'Inbox/Call Sam.md': '---\ntype: task\nstatus: inbox\ndue: 2026-10-20\n---\n' },
    });
    await api.send(clarify({ path: 'Inbox/Call Sam.md', due: null, defer: '2026-10-15' }));
    expect(api.files.get('Inbox/Call Sam.md')?.text).toBe(
      '---\ntype: task\nstatus: inbox\ndefer: 2026-10-15\n---\n',
    );
  });

  it.each([
    ['no path', { status: 'next-action' }],
    ['a path that is not one', { path: '../Out.md', status: 'next-action' }],
    ['a note in .atlas', { path: '.atlas/types/person.md', status: 'next-action' }],
    ['a note that is not there', { path: 'Inbox/Gone.md', status: 'next-action' }],
    ['a status that is not one of the eight', { path: 'Inbox/Call Sam.md', status: 'done' }],
    ['a status that is not a string', { path: 'Inbox/Call Sam.md', status: 3 }],
    ['a day that is not a day', { path: 'Inbox/Call Sam.md', due: '2026-13-01' }],
    ['a person in .atlas', { path: 'Inbox/Call Sam.md', waitingOn: '.atlas/types/person.md' }],
    ['a person who is a project', { path: 'Inbox/Call Sam.md', waitingOn: 'Projects/Atlas.md' }],
    ['a project that is a person', { path: 'Inbox/Call Sam.md', project: 'People/Mara Quill.md' }],
    ['a project given as null', { path: 'Inbox/Call Sam.md', project: null }],
    ['contexts that are not strings', { path: 'Inbox/Call Sam.md', contexts: ['@desk', 4] }],
    ['asTask that is not a boolean', { path: 'Inbox/Call Sam.md', asTask: 'yes' }],
    ['nothing chosen', { path: 'Inbox/Call Sam.md' }],
  ])('refuses %s as invalid, writing nothing', async (_, body) => {
    const api = apiFixture({ files: FILES });
    const response = await api.send(clarify(body));
    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
    expect(api.files.get('Inbox/Call Sam.md')?.text).toBe(CAPTURED);
  });

  it.each(['path', 'project', 'waitingOn'])(
    'refuses a %s in .atlas by what it is, before looking for it',
    async (field) => {
      const api = apiFixture({ files: FILES });
      const body = {
        path: 'Inbox/Call Sam.md',
        status: 'waiting',
        [field]: '.atlas/types/person.md',
      };
      const response = await api.send(clarify(body));
      expect(codeOf(response)).toBe('invalid');
      expect(JSON.stringify(response.body)).toContain(`${field} must be a note`);
      expect(api.writes).toEqual([]);
    },
  );

  it('leaves a note being typed in alone, never saving the typing', async () => {
    const api = apiFixture({ files: FILES });
    const flushed: (readonly VaultPath[])[] = [];
    api.deps = {
      ...api.deps,
      movingNotes: {
        ...api.deps.movingNotes,
        state: (path) => (path === 'Inbox/Call Sam.md' ? 'dirty' : 'closed'),
        flush: async (paths) => void flushed.push(paths),
      },
    };

    const response = await api.send(clarify({ path: 'Inbox/Call Sam.md', status: 'backlog' }));

    expect(codeOf(response)).toBe('unsaved_in_app');
    expect(flushed.flat()).toEqual([]);
    expect(api.files.get('Inbox/Call Sam.md')?.text).toBe(CAPTURED);
  });

  it('answers conflict, keeping the edit, when the note changed on disk while it was being clarified', async () => {
    const api = apiFixture({ files: FILES });
    const edited = `${CAPTURED}Typed in another editor.\n`;
    const held = api.files.get.bind(api.files);
    let read = false;
    // Another editor saves the note right after the route first reads it.
    api.files.get = (at) => {
      const note = held(at);
      if (at === 'Inbox/Call Sam.md' && !read && note !== undefined) {
        read = true;
        api.files.set(at, { text: edited, modified: note.modified + 100 });
      }
      return note;
    };

    const response = await api.send(clarify({ path: 'Inbox/Call Sam.md', status: 'backlog' }));

    expect(codeOf(response)).toBe('conflict');
    expect(api.files.get('Inbox/Call Sam.md')?.text).toBe(edited);
    expect(api.writes).toEqual([]);
  });

  it('decides on a task the Inbox does not list, and refuses an archived one', async () => {
    const files = {
      ...FILES,
      'Tasks/Doing.md': '---\ntype: task\nstatus: in-progress\n---\n',
      'Archive/Tasks/Old.md': '---\ntype: task\nstatus: archive\n---\n',
    };
    const api = apiFixture({ files });
    expect(
      (
        await api.send(
          clarify({ path: 'Tasks/Doing.md', status: 'waiting', waitingOn: 'People/Mara Quill.md' }),
        )
      ).status,
    ).toBe(200);
    expect(api.files.get('Tasks/Doing.md')?.text).toContain('status: waiting');
    const archived = await api.send(clarify({ path: 'Archive/Tasks/Old.md', status: 'backlog' }));
    expect(codeOf(archived)).toBe('invalid');
    expect(api.files.get('Archive/Tasks/Old.md')?.text).toBe(files['Archive/Tasks/Old.md']);
  });

  it('answers no_vault when no vault is open', async () => {
    const api = apiFixture({ files: FILES });
    api.open = null;
    const response = await api.send(clarify({ path: 'Inbox/Call Sam.md', status: 'backlog' }));
    expect(codeOf(response)).toBe('no_vault');
  });
});

describe('GET /v1/inbox — one Inbox', () => {
  it('lists a task at Inbox outside the folder, with what it says, until it is clarified', async () => {
    const files: Record<string, string> = {
      'Tasks/Imported.md': '---\ntype: task\nstatus: inbox\ndue: 2026-10-20\n---\n',
      'Tasks/Moving.md': '---\ntype: task\nstatus: in-progress\n---\n',
    };
    const listed = async () => {
      const api = apiFixture({
        files,
        index: { query: atlasQueryIndex({ markdown: fakeMarkdown(), files }) },
      });
      return bodyOf(await api.send({ method: 'GET', path: '/v1/inbox' }))['items'];
    };

    expect(await listed()).toEqual([
      expect.objectContaining({
        path: 'Tasks/Imported.md',
        arrivedIn: '',
        task: expect.objectContaining({ status: 'inbox', due: '2026-10-20', project: null }),
      }),
    ]);

    files['Tasks/Imported.md'] = '---\ntype: task\nstatus: next-action\n---\n';
    expect(await listed()).toEqual([]);
  });
});
