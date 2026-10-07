import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriExternalLinks } = await import('./tauri-external-links.ts');

describe('tauriExternalLinks', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the host to open the link', async () => {
    invoke.mockResolvedValue(null);
    await tauriExternalLinks.open('https://claude.ai/artifact/abc');
    expect(invoke).toHaveBeenCalledWith('open_url', { url: 'https://claude.ai/artifact/abc' });
  });

  it("turns the host's refusal into an Error", async () => {
    invoke.mockImplementation(() => Promise.reject('only web links can be opened, not file:'));
    await expect(tauriExternalLinks.open('file:///etc/passwd')).rejects.toThrow(
      'only web links can be opened, not file:',
    );
  });
});
