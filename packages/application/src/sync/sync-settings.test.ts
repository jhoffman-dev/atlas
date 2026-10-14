import { describe, expect, it } from 'vitest';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { settingsNameThisMac } from './sync-settings.ts';

/** A vault whose settings note says `said`, or whose frontmatter cannot be read. */
function vaultSaying(said: Record<string, unknown>, problem: string | null = null) {
  return {
    fs: fakeVaultFs({
      readNotes: async () => [
        { path: '.atlas/settings.md', text: '---\n---\n', modified: 1, size: 1 },
      ],
    }),
    markdown: {
      ...fakeMarkdown(),
      frontmatterProperties: () => said,
      frontmatterProblem: () => problem,
    },
  };
}

describe('settingsNameThisMac (ADR-0035 part 4: read after each pull)', () => {
  it('is true when the settings name this Mac by its id', async () => {
    const vault = vaultSaying({ automationsMac: 'mac-laptop' });
    await expect(settingsNameThisMac({ ...vault, thisMacId: 'mac-laptop' })).resolves.toBe(true);
  });

  it('is false when they name another Mac, whatever this one is called', async () => {
    const vault = vaultSaying({ automationsMac: 'mac-studio', automationsMacName: 'Laptop' });
    await expect(settingsNameThisMac({ ...vault, thisMacId: 'mac-laptop' })).resolves.toBe(false);
  });

  it('is true when they name no Mac, as before sync', async () => {
    await expect(
      settingsNameThisMac({ ...vaultSaying({}), thisMacId: 'mac-laptop' }),
    ).resolves.toBe(true);
  });

  it('rejects when the settings cannot be read, rather than guessing either way', async () => {
    const vault = vaultSaying({ automationsMac: 'mac-laptop' }, 'bad indentation');
    await expect(settingsNameThisMac({ ...vault, thisMacId: 'mac-laptop' })).rejects.toThrow();
  });
});
