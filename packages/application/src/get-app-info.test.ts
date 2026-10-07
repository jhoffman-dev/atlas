import { describe, expect, it } from 'vitest';
import { InvalidAppInfoError } from '@atlas/domain';
import { getAppInfo } from './get-app-info.ts';
import type { AppInfoPort } from './ports.ts';

const portReturning = (value: { name: string; version: string }): AppInfoPort => ({
  read: () => Promise.resolve(value),
});

describe('getAppInfo', () => {
  it('returns validated app info from the port', async () => {
    const result = await getAppInfo({
      appInfo: portReturning({ name: 'Atlas', version: '0.1.0' }),
    });
    expect(result).toEqual({ name: 'Atlas', version: '0.1.0' });
  });

  it('rejects host values that break the domain rules', async () => {
    const appInfo = portReturning({ name: 'Atlas', version: 'nightly' });
    await expect(getAppInfo({ appInfo })).rejects.toThrow(InvalidAppInfoError);
  });

  it('propagates a port failure rather than swallowing it', async () => {
    const appInfo: AppInfoPort = { read: () => Promise.reject(new Error('host unavailable')) };
    await expect(getAppInfo({ appInfo })).rejects.toThrow('host unavailable');
  });
});
