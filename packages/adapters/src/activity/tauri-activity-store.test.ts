import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriActivityStore } = await import('./tauri-activity-store.ts');

const VAULT = '/Users/j/Vault';

describe('tauriActivityStore', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('hands the host the text to append, and answers the size it reports', async () => {
    invoke.mockResolvedValue(128);
    await expect(tauriActivityStore.append({ vault: VAULT, text: '{"a":1}\n' })).resolves.toBe(128);
    expect(invoke).toHaveBeenCalledWith('activity_append', { vault: VAULT, text: '{"a":1}\n' });
  });

  it('reads the vault’s whole file', async () => {
    invoke.mockResolvedValue('line\n');
    await expect(tauriActivityStore.read({ vault: VAULT })).resolves.toBe('line\n');
    expect(invoke).toHaveBeenCalledWith('activity_read', { vault: VAULT });
  });

  it('replaces the vault’s file with the text', async () => {
    invoke.mockResolvedValue(null);
    await tauriActivityStore.replace({ vault: VAULT, text: '' });
    expect(invoke).toHaveBeenCalledWith('activity_replace', { vault: VAULT, text: '' });
  });

  it("turns the host's refusal into an Error", async () => {
    invoke.mockImplementation(() => Promise.reject('cannot write the activity log: disk full'));
    await expect(tauriActivityStore.append({ vault: VAULT, text: 'x' })).rejects.toThrow(
      'cannot write the activity log: disk full',
    );
    await expect(tauriActivityStore.read({ vault: VAULT })).rejects.toBeInstanceOf(Error);
  });
});
