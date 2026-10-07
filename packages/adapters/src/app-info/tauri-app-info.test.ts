import { describe, expect, it, vi, beforeEach } from 'vitest';

const getName = vi.fn<() => Promise<string>>();
const getVersion = vi.fn<() => Promise<string>>();
vi.mock('@tauri-apps/api/app', () => ({
  getName: () => getName(),
  getVersion: () => getVersion(),
}));

const { tauriAppInfo } = await import('./tauri-app-info.ts');

describe('tauriAppInfo', () => {
  beforeEach(() => {
    getName.mockReset();
    getVersion.mockReset();
  });

  it('combines the runtime name and version into one value', async () => {
    getName.mockResolvedValue('Atlas');
    getVersion.mockResolvedValue('0.1.0');
    await expect(tauriAppInfo.read()).resolves.toEqual({ name: 'Atlas', version: '0.1.0' });
  });

  it('propagates a runtime failure rather than returning a half-filled value', async () => {
    getName.mockResolvedValue('Atlas');
    getVersion.mockRejectedValue(new Error('ipc closed'));
    await expect(tauriAppInfo.read()).rejects.toThrow('ipc closed');
  });
});
