/**
 * GET /v1/meetings (P28-04): the vault's meetings, newest first, with the
 * import's verdict on each — the error it wrote into a file that failed, the
 * meeting a duplicate is a copy of — run for real over the index's tables.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const meeting = (fields: Record<string, unknown>) =>
  jsonNote({
    type: 'meeting',
    atlas_import: 'meeting/v1',
    provider: 'gemini',
    external_id: 'g-1',
    ...fields,
  });

const FILES = {
  'Inbox/Meetings/2026-10-06 Standup.md': meeting({
    title: 'Standup',
    date: '2026-10-06',
    start: '09:30',
    end: '09:45',
    kind: 'Standup',
    atlas_import_outcome: 'imported',
  }),
  'Archive/Inbox/Meetings/2026-10-06 Standup 2.md': meeting({
    title: 'Standup',
    date: '2026-10-06',
    start: '09:30',
    atlas_import_outcome: 'duplicate',
    atlas_duplicate_of: '[[2026-10-06 Standup]]',
  }),
  'Projects/Larkspur/2026-10-01 Kickoff.md': meeting({
    title: 'Larkspur Payroll kickoff',
    date: '2026-10-01',
    start: '14:00',
    external_id: 'g-2',
  }),
  'Inbox/Meetings/2026-10-02 Vendor call.md': jsonNote({
    atlas_import: 'meeting/v1',
    date: '2026-10-02',
    atlas_import_error: 'type is required; title is required',
  }),
  'Notes/Lunch.md': jsonNote({ type: 'note', date: '2026-10-07' }),
};

function api() {
  const markdown = jsonMarkdown();
  return apiFixture({
    files: FILES,
    markdown,
    index: { query: atlasQueryIndex({ files: FILES, markdown }) },
  });
}

const list = (query: Record<string, string> = {}) =>
  api().send({ method: 'GET', path: '/v1/meetings', query });

const paths = (body: Record<string, unknown>) =>
  (body['meetings'] as { path: string }[]).map((meeting) => meeting.path);

describe('GET /v1/meetings', () => {
  it('lists meetings and files that failed import, newest first, as their files say', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const body = bodyOf(response);
    expect(paths(body)).toEqual([
      'Inbox/Meetings/2026-10-06 Standup.md',
      'Inbox/Meetings/2026-10-02 Vendor call.md',
      'Projects/Larkspur/2026-10-01 Kickoff.md',
    ]);
    expect((body['meetings'] as unknown[])[0]).toEqual({
      path: 'Inbox/Meetings/2026-10-06 Standup.md',
      title: 'Standup',
      date: '2026-10-06',
      start: '09:30',
      end: '09:45',
      kind: 'Standup',
      provider: 'gemini',
      externalId: 'g-1',
      importOutcome: 'imported',
      importError: null,
      duplicateOf: null,
    });
    expect((body['meetings'] as unknown[])[1]).toMatchObject({
      title: '2026-10-02 Vendor call',
      provider: null,
      importOutcome: null,
      importError: 'type is required; title is required',
    });
    expect(body).toMatchObject({ truncated: false, next: null });
  });

  it('reads, and so says nothing in the Activity log', async () => {
    const fixture = api();
    await fixture.send({ method: 'GET', path: '/v1/meetings' });
    expect(fixture.activity.reports).toEqual([]);
    expect(fixture.writes).toEqual([]);
  });

  it('keeps meetings on or after `since`', async () => {
    expect(paths(bodyOf(await list({ since: '2026-10-02' })))).toEqual([
      'Inbox/Meetings/2026-10-06 Standup.md',
      'Inbox/Meetings/2026-10-02 Vendor call.md',
    ]);
  });

  it('lists an archived duplicate, saying what it is a copy of, only when asked', async () => {
    const body = bodyOf(await list({ includeArchived: 'true' }));

    const copy = (body['meetings'] as Record<string, unknown>[]).find(
      (meeting) => meeting['path'] === 'Archive/Inbox/Meetings/2026-10-06 Standup 2.md',
    );
    expect(copy).toMatchObject({
      importOutcome: 'duplicate',
      duplicateOf: '[[2026-10-06 Standup]]',
      archived: true,
    });
    expect(paths(bodyOf(await list()))).not.toContain(
      'Archive/Inbox/Meetings/2026-10-06 Standup 2.md',
    );
  });

  it('pages with limit and offset, saying where the next page starts', async () => {
    const first = bodyOf(await list({ limit: '2' }));
    const second = bodyOf(await list({ limit: '2', offset: '2' }));

    expect(first).toMatchObject({ truncated: true, next: 2 });
    expect(paths(first)).toHaveLength(2);
    expect(paths(second)).toEqual(['Projects/Larkspur/2026-10-01 Kickoff.md']);
    expect(second).toMatchObject({ truncated: false, next: null });
  });

  it.each([
    [{ since: '2026-02-30' }],
    [{ since: 'last week' }],
    [{ since: '2026-10-06T09:30' }],
    [{ limit: '0' }],
    [{ limit: '501' }],
    [{ offset: '-1' }],
    [{ includeArchived: 'yes' }],
  ])('refuses %j as invalid', async (query) => {
    const response = await list(query);
    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('invalid');
  });

  it('says the index could not list them, without its paths', async () => {
    const response = await apiFixture({
      index: {
        query: async () => {
          throw new Error('disk I/O error at /Users/j/Library/atlas/index.sqlite');
        },
      },
    }).send({ method: 'GET', path: '/v1/meetings' });

    expect(response.status).toBe(422);
    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(bodyOf(response))).not.toContain('/Users/j');
  });
});
