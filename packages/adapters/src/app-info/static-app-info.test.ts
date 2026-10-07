import { describe, expect, it } from 'vitest';
import { staticAppInfo } from './static-app-info.ts';

describe('staticAppInfo', () => {
  it('reads back the value it was given', async () => {
    const port = staticAppInfo({ name: 'Atlas', version: '0.1.0' });
    await expect(port.read()).resolves.toEqual({ name: 'Atlas', version: '0.1.0' });
  });
});
