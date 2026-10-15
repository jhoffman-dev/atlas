import { describe, expect, it } from 'vitest';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { automationsSettingsReading } from './sync-settings.ts';

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

/** A vault with no settings note, or one `readNotes` leaves out: unreadable as text, or not permitted. */
function vaultWithout() {
  return { fs: fakeVaultFs({ readNotes: async () => [] }), markdown: fakeMarkdown() };
}

describe('automationsSettingsReading (ADR-0035 part 4: read after each pull, and before each act)', () => {
  const mac = { thisMacId: 'mac-laptop', syncs: true };

  it('names this Mac when the settings name it by its id', async () => {
    const vault = vaultSaying({ automationsMac: 'mac-laptop' });
    await expect(automationsSettingsReading({ ...vault, ...mac })).resolves.toBe('names-this-mac');
  });

  it('names another Mac when they do, whatever this one is called', async () => {
    const vault = vaultSaying({ automationsMac: 'mac-studio', automationsMacName: 'Laptop' });
    await expect(automationsSettingsReading({ ...vault, ...mac })).resolves.toBe(
      'names-another-mac',
    );
  });

  it('names this Mac when a readable note names no Mac, as before sync', async () => {
    await expect(automationsSettingsReading({ ...vaultSaying({}), ...mac })).resolves.toBe(
      'names-this-mac',
    );
  });

  it('is unreadable when the frontmatter cannot be read, rather than guessing either way', async () => {
    const vault = vaultSaying({ automationsMac: 'mac-laptop' }, 'bad indentation');
    await expect(automationsSettingsReading({ ...vault, ...mac })).resolves.toBe('unreadable');
  });

  it('is unreadable when a synced vault’s note is missing or cannot be read as text', async () => {
    await expect(automationsSettingsReading({ ...vaultWithout(), ...mac })).resolves.toBe(
      'unreadable',
    );
  });

  it('is unreadable when the read itself fails', async () => {
    const vault = {
      fs: fakeVaultFs({
        readNotes: async () => {
          throw new Error('Operation not permitted');
        },
      }),
      markdown: fakeMarkdown(),
    };
    await expect(automationsSettingsReading({ ...vault, ...mac })).resolves.toBe('unreadable');
  });

  it('reads a vault that does not sync, with no note, as naming every Mac, as before', async () => {
    await expect(
      automationsSettingsReading({ ...vaultWithout(), ...mac, syncs: false }),
    ).resolves.toBe('names-this-mac');
  });
});
