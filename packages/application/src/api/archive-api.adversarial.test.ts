/**
 * Adversarial pass on the Archive through the API (merge 10c51a9): what the
 * answer tells a caller about where its notes went, on a disk that ignores
 * case, and when the vault is switched while a batch is running.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, OTHER_VAULT } from '../testing/api-fixture.ts';

const archive = (paths: unknown) => ({
  method: 'POST' as const,
  path: '/v1/archive',
  body: { paths },
});
const unarchive = (paths: unknown) => ({
  method: 'POST' as const,
  path: '/v1/unarchive',
  body: { paths },
});

describe('the Archive answers the vault’s spelling of every folder a note lands in', () => {
  it('archives into the Archive’s subfolder as the disk spells it', async () => {
    // `Projects` was renamed `projects` in the Archive by hand, or an older note came from a folder spelt so.
    const api = apiFixture({
      files: { 'Archive/projects/Old.md': 'x\n', 'Projects/Lease.md': 'y\n' },
      caseInsensitive: true,
    });

    const response = await api.send(archive(['Projects/Lease.md']));

    expect(bodyOf(response)['moves']).toEqual([
      { from: 'Projects/Lease.md', to: 'Archive/projects/Lease.md' },
    ]);
  });

  it('unarchives into the folder as the disk spells it now, not as the record spelt it', async () => {
    // Archived from `Projects`, which was then renamed to `projects` (a case-only rename the app allows).
    const api = apiFixture({
      files: {
        'Archive/Projects/Lease.md':
          '---\narchived: 2026-09-01\narchivedFrom: Projects/Lease.md\n---\nbody\n',
        'projects/Other.md': 'z\n',
      },
      caseInsensitive: true,
    });

    const response = await api.send(unarchive(['Archive/Projects/Lease.md']));

    expect(bodyOf(response)['moves']).toEqual([
      { from: 'Archive/Projects/Lease.md', to: 'projects/Lease.md' },
    ]);
    expect(api.followed).toEqual([{ from: 'Archive/Projects/Lease.md', to: 'projects/Lease.md' }]);
  });
});

describe('a batch interrupted by a vault switch says what already moved', () => {
  it('lists the note that moved before the switch rather than answering as if nothing had', async () => {
    const api = apiFixture({ files: { 'A.md': 'a\n', 'B.md': 'b\n' } });
    const moving = api.deps.fs.moveEntry;
    let moves = 0;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        moveEntry: async (args) => {
          await moving(args);
          moves += 1;
          // The person opens another vault just after the first note has gone into the Archive.
          if (moves === 1) api.open = OTHER_VAULT;
        },
      },
    };

    const response = await api.send(archive(['A.md', 'B.md']));

    expect(api.files.has('Archive/A.md')).toBe(true);
    expect(JSON.stringify(response.body)).toContain('Archive/A.md');
  });
});
