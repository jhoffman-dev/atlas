import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { fakeMarkdown, fakeOpenNotes } from '../testing/fake-ports.ts';
import { tagIndexQuery } from '../testing/tag-index.ts';

/*
 * Adversarial pass on Phase 20's tags through the local API, as a token holder
 * or a prompt-injected MCP client would drive it: renames that join two tags
 * without `merge: true`, and cursors the API never handed out.
 */

type Api = ReturnType<typeof apiFixture>;

function vault(files: Record<string, string>): Api {
  const markdown = fakeMarkdown();
  const api = apiFixture({ files, markdown, index: { query: tagIndexQuery({ files, markdown }) } });
  api.deps = { ...api.deps, openNotes: fakeOpenNotes() };
  return api;
}

const rename = (api: Api, tag: string, body: unknown) =>
  api.send({ method: 'POST', path: `/v1/tags/${encoded(tag)}/rename`, body });

const textOf = (api: Api, path: string) => api.files.get(path)?.text;

describe('a rename that joins two tags is refused without merge: true', () => {
  it('when the new name is a tag in use only as the parent of others', async () => {
    // `#beta` exists in the tree (GET /v1/tags answers it, total 1). Once `#alpha`
    // becomes `#beta`, renaming `#beta` back also carries `#beta/y` off with it.
    const api = vault({ 'a.md': 'Uses #alpha.\n', 'b.md': 'Uses #beta/y.\n' });

    const response = await rename(api, 'alpha', { to: 'beta' });

    expect(codeOf(response)).toBe('exists');
    expect(api.writes).toEqual([]);
  });

  it('when the new name, written back, reads as a tag already in use', async () => {
    // `plan a` passes every check, but `#plan a#` reads back as `#plan`: the
    // renamed notes silently join `#plan`.
    const api = vault({ 'a.md': 'Uses #idea.\n', 'b.md': 'Uses #plan.\n' });

    const response = await rename(api, 'idea', { to: 'plan a' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(textOf(api, 'a.md')).toBe('Uses #idea.\n');
  });

  it('when two renames into one new name run at once', async () => {
    // Each plans before the other writes, so neither sees the other's `#concept`.
    const api = vault({ 'a.md': 'Uses #idea.\n', 'b.md': 'Uses #thought.\n' });

    const answers = await Promise.all([
      rename(api, 'idea', { to: 'concept' }),
      rename(api, 'thought', { to: 'concept' }),
    ]);

    expect(answers.map(codeOf).sort()).toEqual(['exists', null]);
  });
});

describe('a cursor this API did not hand out', () => {
  // cursor.ts: "The path a cursor carries; one this API did not hand out is `invalid`".
  // A forged one past every path answers an empty last page, which reads as the end.
  const forged = btoa('zzz-not-a-path');

  it('is refused by GET /v1/tags/{tag}/notes', async () => {
    const api = vault({ 'a.md': 'Uses #idea.\n' });
    const response = await api.send({
      method: 'GET',
      path: '/v1/tags/idea/notes',
      query: { cursor: forged },
    });
    expect(codeOf(response)).toBe('invalid');
  });

  it('is refused by GET /v1/notes', async () => {
    const api = vault({ 'a.md': 'Uses #idea.\n' });
    const response = await api.send({
      method: 'GET',
      path: '/v1/notes',
      query: { cursor: forged },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(bodyOf(response)['notes']).toBeUndefined();
  });
});
