/**
 * Adversarial pass on #111: `GET /v1/today` is a read. Asked with a body, with
 * parameters it does not take, or by another method, it writes nothing.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, TODAY } from '../testing/api-fixture.ts';
import { fakeMarkdown } from '../testing/fake-ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const note = (frontmatter: readonly string[]) => ['---', ...frontmatter, '---', ''].join('\n');
const FILES = {
  'Tasks/Call Mara Quill.md': note(['type: task', 'status: next-action', `due: ${TODAY}`]),
  'Tasks/Write to Tobias Fenn.md': note([
    'type: task',
    'status: waiting',
    'waiting_on: Tobias Fenn',
  ]),
};

function fixture() {
  const query = atlasQueryIndex({ markdown: fakeMarkdown(), files: FILES });
  return apiFixture({ files: FILES, index: { query } });
}

describe('GET /v1/today, asked for more than it gives', () => {
  it('ignores parameters and a body it does not take, and writes nothing', async () => {
    const api = fixture();
    const plain = await api.send({ method: 'GET', path: '/v1/today' });
    const dressed = await api.send({
      method: 'GET',
      path: '/v1/today',
      query: {
        today: '1999-01-01',
        vault: '/Users/someone/Other Vault',
        done: 'Tasks/Call Mara Quill.md',
      },
      body: { done: ['Tasks/Call Mara Quill.md'], defer: 7 },
    });
    expect(dressed.status).toBe(200);
    expect(bodyOf(dressed)).toEqual(bodyOf(plain));
    expect((bodyOf(dressed)['today'] as Record<string, unknown>)['today']).toBe(TODAY);
    expect(api.writes).toEqual([]);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'has no %s, and writes nothing',
    async (method) => {
      const api = fixture();
      const response = await api.send({
        method: method as 'GET',
        path: '/v1/today',
        body: { done: ['Tasks/Call Mara Quill.md'] },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(api.writes).toEqual([]);
      expect([...api.files.values()].map((file) => file.text)).toEqual(Object.values(FILES));
    },
  );
});
