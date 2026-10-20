import { describe, expect, it } from 'vitest';
import { createVaultPath as p, NOT_DUPLICATE_PEOPLE_KEY } from '@atlas/domain';
import { refreshIndex } from '../index/refresh-index.ts';
import { createSettingsWriter } from '../settings/index.ts';
import {
  guardedVault,
  jsonFrontmatterMarkdown as markdown,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { dismissPossibleDuplicate, loadPossibleDuplicates } from './possible-duplicates.ts';

/* Adversarial probes of "Not the same" (PR #467, #464). Fictional names only. */

const SETTINGS = '.atlas/settings.md';

describe('dismissing possible duplicates (attack-467)', () => {
  it('remembers both of two pairs dismissed one right after the other', async () => {
    const vault = guardedVault({
      'Tobias Fenn.md': note({ type: 'person' }, ''),
      'People/Tobias Fenn.md': note({ type: 'person' }, ''),
      'Mara.md': note({ type: 'person' }, ''),
      'People/Mara.md': note({ type: 'person' }, ''),
      [SETTINGS]: note({}, ''),
    });
    const index = sqliteIndexPort();
    await refreshIndex({ fs: vault.fs, index, markdown });
    const ports = { index, fs: vault.fs, markdown };
    const settings = createSettingsWriter({ fs: vault.fs, markdown });
    // Two rows' "Not the same", clicked in quick succession: the app does not wait between them.
    await Promise.all([
      dismissPossibleDuplicate({
        ports,
        settings,
        pair: { left: p('People/Tobias Fenn.md'), right: p('Tobias Fenn.md') },
      }),
      dismissPossibleDuplicate({
        ports,
        settings,
        pair: { left: p('Mara.md'), right: p('People/Mara.md') },
      }),
    ]);
    const held = markdown.frontmatterProperties(vault.text(SETTINGS)!.replace(/\n$/u, ''));
    expect(held[NOT_DUPLICATE_PEOPLE_KEY]).toHaveLength(2);
    expect(await loadPossibleDuplicates(ports)).toEqual([]);
  });
});
