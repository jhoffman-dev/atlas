import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import { jsonMarkdown } from '../testing/json-markdown.ts';

/* #10 through the local API: the person's name, read only. */

const SETTINGS = '.atlas/settings.md';

const read = (api: ReturnType<typeof apiFixture>) =>
  api.send({ method: 'GET', path: '/v1/profile' });

describe('GET /v1/profile', () => {
  it('answers the names Settings → Profile holds, and the placeholder', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: {
        [SETTINGS]: '---\n{"profileName":"James Hoffman","profilePreferredName":"James"}\n---\n',
      },
    });
    expect(bodyOf(await read(api))['profile']).toEqual({
      name: 'James Hoffman',
      preferredName: 'James',
      placeholder: '[Your name]',
    });
  });

  it('answers no name, rather than a guess, when none is set', async () => {
    const api = apiFixture({ markdown: jsonMarkdown(), files: {} });
    expect(bodyOf(await read(api))['profile']).toEqual({
      name: null,
      preferredName: null,
      placeholder: '[Your name]',
    });
  });

  it('refuses when the settings note cannot be read, rather than answering no name', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: { [SETTINGS]: '---\n{oops\n---\n' },
    });
    const answer = await read(api);
    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(codeOf(answer)).not.toBeNull();
  });

  it('writes nothing', async () => {
    const api = apiFixture({ markdown: jsonMarkdown(), files: {} });
    await read(api);
    expect([...api.files.keys()]).toEqual([]);
  });
});
