import { describe, expect, it } from 'vitest';
import { InvalidAppInfoError } from '@dfai/domain';
import { getAppInfo } from './get-app-info.ts';
import type { AppInfoPort } from './ports.ts';

const portReturning = (value: {
  name: string;
  version: string;
  build?: string | null;
}): AppInfoPort => ({
  read: () => Promise.resolve(value),
});

describe('getAppInfo', () => {
  it('returns validated app info from the port', async () => {
    const result = await getAppInfo({
      appInfo: portReturning({ name: 'DFAI', version: '0.1.0' }),
    });
    expect(result).toEqual({ name: 'DFAI', version: '0.1.0', build: null });
  });

  it('passes on the commit the build was made from', async () => {
    const appInfo = portReturning({ name: 'DFAI', version: '0.1.0', build: '61e907b' });
    expect((await getAppInfo({ appInfo })).build).toBe('61e907b');
  });

  it('rejects host values that break the domain rules', async () => {
    const appInfo = portReturning({ name: 'DFAI', version: 'nightly' });
    await expect(getAppInfo({ appInfo })).rejects.toThrow(InvalidAppInfoError);
  });

  it('propagates a port failure rather than swallowing it', async () => {
    const appInfo: AppInfoPort = { read: () => Promise.reject(new Error('host unavailable')) };
    await expect(getAppInfo({ appInfo })).rejects.toThrow('host unavailable');
  });
});
