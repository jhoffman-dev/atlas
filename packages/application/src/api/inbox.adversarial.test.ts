/**
 * Adversarial: `POST /v1/inbox/process` (P30-01), the route
 * `atlas_process_inbox_item` calls. Any local process can reach it, so what
 * it files and where is held to the same limits as the app's Process.
 */

import { describe, expect, it } from 'vitest';
import { isArchivedPath, isInInbox } from '@atlas/domain';
import { apiFixture, bodyOf } from '../testing/api-fixture.ts';

const PROJECT = '---\ntype: project\n---\n\nThe plan.\n';

const processInbox = (body: unknown) => ({
  method: 'POST' as const,
  path: '/v1/inbox/process',
  body,
});

const movedTo = (body: Record<string, unknown>) =>
  (body['moves'] as { to: string }[]).map((move) => move.to);

describe('POST /v1/inbox/process — adversarial', () => {
  it('never archives a note through a project kept at Archive.md', async () => {
    const api = apiFixture({ files: { 'Archive.md': PROJECT, 'Inbox/Call Mara.md': 'c\n' } });

    const response = await api.send(
      processInbox({ paths: ['Inbox/Call Mara.md'], project: 'Archive.md' }),
    );

    const archived =
      response.status === 200 ? movedTo(bodyOf(response)).filter(isArchivedPath) : [];
    expect(archived).toEqual([]);
    expect([...api.files.keys()].filter(isArchivedPath)).toEqual([]);
  });

  it('never reports a note as filed that is still in the Inbox, through a project at Inbox.md', async () => {
    const api = apiFixture({ files: { 'Inbox.md': PROJECT, 'Inbox/Call Mara.md': 'c\n' } });

    const response = await api.send(
      processInbox({ paths: ['Inbox/Call Mara.md'], project: 'Inbox.md' }),
    );

    const stillInInbox = response.status === 200 ? movedTo(bodyOf(response)).filter(isInInbox) : [];
    expect(stillInInbox).toEqual([]);
  });
});
