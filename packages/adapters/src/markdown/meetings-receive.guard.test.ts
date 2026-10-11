/**
 * POST /v1/meetings checks the mapped file against meeting/v1 before writing
 * it. The mapper is built never to write a file the contract refuses, so here
 * it is made to, to show the check stops it. All names are made up.
 */
import { expect, it, vi } from 'vitest';
import { apiFixture, codeOf } from '@atlas/application';
import { atlasQueryIndex } from '@atlas/application/testing/sqlite';
import type * as Domain from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

vi.mock('@atlas/domain', async (importOriginal) => {
  const original = await importOriginal<typeof Domain>();
  return {
    ...original,
    mapMeeting: (...args: Parameters<typeof original.mapMeeting>) => {
      const file = original.mapMeeting(...args);
      return { ...file, content: file.content.replace(/^title: .*$/m, "title: ''") };
    },
  };
});

it('refuses a mapped file the contract would refuse, as invalid, and writes nothing', async () => {
  const api = apiFixture({
    markdown: remarkMarkdown,
    index: { query: atlasQueryIndex({ files: {}, markdown: remarkMarkdown }) },
  });
  const response = await api.send({
    method: 'POST',
    path: '/v1/meetings',
    body: {
      provider: 'gemini',
      sourceId: 'fake-meeting-0001',
      title: 'Platform weekly sync',
      subject: 'Notes: Platform weekly sync Oct 6, 2026 10:00',
    },
  });

  expect(codeOf(response)).toBe('invalid');
  expect(JSON.stringify(response.body)).toContain('meeting/v1 refuses');
  expect(api.writes).toEqual([]);
});
