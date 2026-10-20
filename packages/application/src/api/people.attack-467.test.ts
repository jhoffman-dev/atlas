import { describe, expect, it } from 'vitest';
import { refreshIndex } from '../index/refresh-index.ts';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import {
  jsonFrontmatterMarkdown as markdown,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';

/*
 * Adversarial probes of POST /v1/people/merge (PR #467, #464): what a caller
 * was shown is what is merged. Fictional names only.
 */

const KEPT = 'People/Mara Quill.md';
const SHORT = 'Mara.md';

async function vault() {
  const api = apiFixture({
    files: {
      [KEPT]: note({ type: 'person', role: 'Payroll lead' }, 'Leads payroll.\n'),
      [SHORT]: note({ type: 'person' }, 'Met at the kickoff.\n'),
      'Kickoff.md': 'With [[Mara]].\n',
    },
    markdown,
  });
  const index = sqliteIndexPort();
  await refreshIndex({ fs: api.fs, index, markdown });
  api.deps = {
    ...api.deps,
    index,
    fs: {
      ...api.deps.fs,
      trashEntry: async ({ path }) => {
        api.files.delete(path);
      },
    },
  };
  return api;
}

describe('POST /v1/people/merge after its preview (attack-467)', () => {
  it('is a conflict, with nothing written, when a merged person changed between the preview a caller saw and its confirm', async () => {
    const api = await vault();
    const shown = await api.send({
      method: 'POST',
      path: '/v1/people/merge',
      body: { keep: KEPT, merge: [SHORT] },
    });
    expect(bodyOf(shown)['merge']).toMatchObject({ conflicts: [], refusal: null });
    // Another program gives the merged person a different role after the caller read the preview.
    const before = api.files.get(SHORT)!;
    api.files.set(SHORT, {
      ...before,
      text: note({ type: 'person', role: 'Analyst' }, 'Met at the kickoff.\n'),
      modified: before.modified + 1,
    });
    const confirmed = await api.send({
      method: 'POST',
      path: '/v1/people/merge',
      body: { keep: KEPT, merge: [SHORT], confirm: true },
    });
    expect(codeOf(confirmed)).toBe('conflict');
    expect(api.writes).toEqual([]);
  });
});
