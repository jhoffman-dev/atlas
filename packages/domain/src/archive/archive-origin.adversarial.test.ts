/**
 * Adversarial pass on the Archive merge (10c51a9): an `archivedFrom` edited
 * through PATCH /v1/notes/{path}/properties by a caller who wants the note out
 * of the person's reach. The invariant under attack: unarchiving never puts a
 * note where the vault hides it.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { restoreDestination } from './archive.ts';

describe('an edited archivedFrom cannot steer a note where the vault hides it', () => {
  it.each(['NODE_MODULES/Plan.md', 'Node_Modules/Plan.md', '.Git/Plan.md'])(
    'ignores %s, which a case-insensitive disk files in a folder the host never walks',
    (archivedFrom) => {
      // On APFS `Node_Modules/Plan.md` is `node_modules/Plan.md`, which the host prunes by name.
      const to = restoreDestination({
        path: createVaultPath('Archive/Plan.md'),
        archivedFrom,
        taken: new Set(),
      });
      expect(to).toBe('Plan.md');
    },
  );
});
