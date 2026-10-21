import { describe, expect, it } from 'vitest';
import { refreshIndex } from '../index/refresh-index.ts';
import { apiFixture, bodyOf } from '../testing/api-fixture.ts';
import {
  jsonFrontmatterMarkdown as markdown,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';

/*
 * Verification of PR #467's fix round: POST /v1/people/merge and links the
 * index has not read yet. Fictional names only.
 */

const KEPT = 'People/Mara Quill.md';
const SHORT = 'Mara.md';

async function vault() {
  const api = apiFixture({
    files: {
      [KEPT]: note({ type: 'person' }, 'Leads payroll.\n'),
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

const merge = (api: Awaited<ReturnType<typeof vault>>, body: unknown) =>
  api.send({ method: 'POST', path: '/v1/people/merge', body });

describe('POST /v1/people/merge and the index (verify-467)', () => {
  it('never trashes a merged person while a note the index has not read yet still links to them', async () => {
    const api = await vault();
    // Another program (or the API's own POST /v1/notes a moment ago) wrote this;
    // the watcher's refresh has not run yet.
    api.files.set('Later.md', { text: 'Ask [[Mara]].\n', modified: 1_000 });
    const shown = bodyOf(await merge(api, { keep: KEPT, merge: [SHORT] }))['merge'] as {
      version: string;
    };
    await merge(api, { keep: KEPT, merge: [SHORT], confirm: true, version: shown.version });
    // Observed: Mara.md is trashed and Later.md still says `[[Mara]]`, a link to nothing.
    const dangling = !api.files.has(SHORT) && api.files.get('Later.md')!.text.includes('[[Mara]]');
    expect(dangling).toBe(false);
  });
});
