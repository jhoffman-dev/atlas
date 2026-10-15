import { describe, expect, it } from 'vitest';
import { nearestNotePaths } from './nearest-note-paths.ts';
import { createVaultPath, type VaultPath } from './vault-path.ts';

const paths = (...each: string[]): VaultPath[] => each.map(createVaultPath);
const near = (wanted: string, among: VaultPath[], limit?: number) =>
  nearestNotePaths(createVaultPath(wanted), among, limit);

describe('nearestNotePaths', () => {
  const vault = paths(
    'Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md',
    'Inbox/Meetings/2026-10-14 Mara Tobias 1-1 (gemini 1a2b).md',
    'Inbox/Meetings/2026-09-30 Mara Tobias 1-1.md',
    'Inbox/Meetings/2026-10-14 Larkspur Standup.md',
    'People/Mara Quill.md',
    'Recipes/Soup.md',
  );

  it('puts the same name in another folder first, whatever its case', () => {
    expect(near('Meeting Notes/2026-10-14 mara tobias 1-1.md', vault)[0]).toBe(
      'Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md',
    );
  });

  it('then ranks by the words the names share', () => {
    expect(near('Meetings/2026-10-14 Mara Tobias.md', vault)).toEqual([
      'Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md',
      'Inbox/Meetings/2026-10-14 Mara Tobias 1-1 (gemini 1a2b).md',
      // Three words of seven in common, against three of eight.
      'Inbox/Meetings/2026-10-14 Larkspur Standup.md',
      'Inbox/Meetings/2026-09-30 Mara Tobias 1-1.md',
      'People/Mara Quill.md',
    ]);
  });

  it('answers at most the limit, and nothing for a name with no word in common', () => {
    expect(near('x/2026-10-14 Mara.md', vault, 2)).toHaveLength(2);
    expect(near('x/Quarterly plan.md', vault)).toEqual([]);
  });

  it('never answers the path it was asked about', () => {
    expect(near('Recipes/Soup.md', vault)).toEqual([]);
  });
});
