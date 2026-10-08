/**
 * The Inbox's Process through the API (P30-01, ADR-0016's amendment for it):
 * filing notes under a project or an area, held to the Archive's limits — user
 * space only, never over anything, never saving someone's typing — with the
 * destination fixed by the note's name and the project's own path.
 */

import { describe, expect, it } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';

const PROJECT = '---\ntype: project\n---\n\nThe app.\n';
const AREA = '---\ntype: area\n---\n\nBeds and seeds.\n';
const PERSON = '---\ntype: person\n---\n\nA neighbour.\n';

const processInbox = (body: unknown) => ({
  method: 'POST' as const,
  path: '/v1/inbox/process',
  body,
});

describe('POST /v1/inbox/process', () => {
  it('files each note under its project’s folder and links it, the rest of it untouched', async () => {
    const api = apiFixture({
      files: {
        'Projects/Atlas.md': PROJECT,
        'Inbox/Call Sam.md': '---\ntype: task\n---\n\nAbout the  *lease*.\n',
        'Inbox/Meetings/Standup.md': 'Notes.\n',
      },
    });

    const response = await api.send(
      processInbox({
        paths: ['Inbox/Call Sam.md', 'Inbox/Meetings/Standup.md'],
        project: 'Projects/Atlas.md',
      }),
    );

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      moves: [
        { from: 'Inbox/Call Sam.md', to: 'Projects/Atlas/Call Sam.md' },
        { from: 'Inbox/Meetings/Standup.md', to: 'Projects/Atlas/Standup.md' },
      ],
      failed: [],
      linksUpdated: 0,
    });
    const filed = api.files.get('Projects/Atlas/Call Sam.md')?.text ?? '';
    expect(filed).toContain('project: [[Atlas]]');
    expect(filed.endsWith('\nAbout the  *lease*.\n')).toBe(true);
    expect(api.files.has('Inbox/Call Sam.md')).toBe(false);
  });

  it('files under an area as readily as a project', async () => {
    const api = apiFixture({ files: { 'Areas/Garden.md': AREA, 'Inbox/Seeds.md': 's\n' } });
    const response = await api.send(
      processInbox({ paths: ['Inbox/Seeds.md'], project: 'Areas/Garden.md' }),
    );
    expect(bodyOf(response)['moves']).toEqual([
      { from: 'Inbox/Seeds.md', to: 'Areas/Garden/Seeds.md' },
    ]);
  });

  it('refuses to file under a note that is not a project or an area, and moves nothing', async () => {
    const api = apiFixture({ files: { 'People/Mara Quill.md': PERSON, 'Inbox/Call.md': 'c\n' } });
    const response = await api.send(
      processInbox({ paths: ['Inbox/Call.md'], project: 'People/Mara Quill.md' }),
    );
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('not a person');
    expect(api.writes).toEqual([]);
    expect(api.files.has('Inbox/Call.md')).toBe(true);
  });

  it('refuses a project in .atlas before reading anything there', async () => {
    const api = apiFixture({
      files: { 'Inbox/Call.md': 'c\n', '.atlas/types/project.md': PROJECT },
    });
    const response = await api.send(
      processInbox({ paths: ['Inbox/Call.md'], project: '.atlas/types/project.md' }),
    );
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('project must be a note');
  });

  it.each([
    ['no project', { paths: ['Inbox/Call.md'] }],
    ['a project that is not a path', { paths: ['Inbox/Call.md'], project: '../Out.md' }],
    ['a project in .atlas', { paths: ['Inbox/Call.md'], project: '.atlas/types/project.md' }],
    ['a project that is not there', { paths: ['Inbox/Call.md'], project: 'Projects/Gone.md' }],
    ['no paths', { paths: [], project: 'Projects/Atlas.md' }],
  ])('refuses %s as invalid, writing nothing', async (_, body) => {
    const api = apiFixture({ files: { 'Projects/Atlas.md': PROJECT, 'Inbox/Call.md': 'c\n' } });
    const response = await api.send(processInbox(body));
    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
  });

  it('lists a note that is not in the Inbox, and files the rest', async () => {
    const api = apiFixture({
      files: { 'Projects/Atlas.md': PROJECT, 'Plan.md': 'p\n', 'Inbox/Call.md': 'c\n' },
    });
    const response = await api.send(
      processInbox({ paths: ['Plan.md', 'Inbox/Call.md'], project: 'Projects/Atlas.md' }),
    );
    expect(bodyOf(response)['failed']).toEqual([
      { path: 'Plan.md', reason: 'It is not in the Inbox.' },
    ]);
    expect(api.files.get('Plan.md')?.text).toBe('p\n');
  });

  it('leaves a note being typed in where it is, never saving the typing', async () => {
    const api = apiFixture({ files: { 'Projects/Atlas.md': PROJECT, 'Inbox/Call.md': 'c\n' } });
    const flushed: (readonly VaultPath[])[] = [];
    api.deps = {
      ...api.deps,
      movingNotes: {
        ...api.deps.movingNotes,
        state: (path) => (path === 'Inbox/Call.md' ? 'dirty' : 'closed'),
        flush: async (paths) => void flushed.push(paths),
      },
    };

    const response = await api.send(
      processInbox({ paths: ['Inbox/Call.md'], project: 'Projects/Atlas.md' }),
    );

    expect(bodyOf(response)['failed']).toEqual([
      { path: 'Inbox/Call.md', reason: expect.any(String), code: 'unsaved_in_app' },
    ]);
    expect(api.files.has('Inbox/Call.md')).toBe(true);
    expect(flushed.flat()).toEqual([]);
  });

  it('never files a note over one already there: it is numbered', async () => {
    const api = apiFixture({
      files: {
        'Projects/Atlas.md': PROJECT,
        'Projects/Atlas/Call.md': 'older\n',
        'Inbox/Call.md': 'newer\n',
      },
    });
    const response = await api.send(
      processInbox({ paths: ['Inbox/Call.md'], project: 'Projects/Atlas.md' }),
    );
    expect(bodyOf(response)['moves']).toEqual([
      { from: 'Inbox/Call.md', to: 'Projects/Atlas/Call 2.md' },
    ]);
    expect(api.files.get('Projects/Atlas/Call.md')?.text).toBe('older\n');
  });
});
