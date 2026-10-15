import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';

/**
 * #214: no list the API answers — what the chat and the MCP tools read —
 * holds more than its cap, however many notes match. Each says how many there
 * are in all and hands out a cursor to read on.
 */
const MANY = 600;
const CAP = 500;
const many = (folder: string, text: string) =>
  Object.fromEntries(
    Array.from({ length: MANY }, (_, at) => [`${folder}/${String(at).padStart(3, '0')}.md`, text]),
  );

describe('the cap on every list of notes (#214)', () => {
  it('refuses a page larger than 500, and lists at most 500 notes of a folder, saying how many there are and where to read on', async () => {
    const api = apiFixture({ files: many('Meetings/2026/10', '# m\n') });

    const tooMany = await api.send({ method: 'GET', path: '/v1/notes', query: { limit: '5000' } });
    const body = bodyOf(
      await api.send({ method: 'GET', path: '/v1/notes', query: { limit: String(CAP) } }),
    );

    expect(codeOf(tooMany)).toBe('invalid');
    expect(body['notes']).toHaveLength(CAP);
    expect(body['total']).toBe(MANY);
    expect(body['next']).toEqual(expect.any(String));
  });

  it('refuses a page larger than 500, lists at most 500 backlinks, and reads on to the rest with the cursor', async () => {
    const files = { 'Target.md': '# T\n', ...many('Notes', 'See [[Target]].\n') };
    const linking = Object.keys(files).filter((at) => at !== 'Target.md');
    const api = apiFixture({ files, index: { backlinks: async () => linking } });
    const path = '/v1/notes/Target.md/backlinks';

    const tooMany = await api.send({ method: 'GET', path, query: { limit: '5000' } });
    const first = bodyOf(await api.send({ method: 'GET', path, query: { limit: String(CAP) } }));
    const rest = bodyOf(
      await api.send({ method: 'GET', path, query: { cursor: String(first['next']) } }),
    );

    expect(codeOf(tooMany)).toBe('invalid');
    expect(first['backlinks']).toHaveLength(CAP);
    expect(first['total']).toBe(MANY);
    expect(rest['backlinks']).toHaveLength(MANY - CAP);
    expect(rest['next']).toBeNull();
  });
});
