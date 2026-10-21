import { describe, expect, it } from 'vitest';
import { staticAppInfo } from './static-app-info.ts';

describe('staticAppInfo', () => {
  it('reads back the value it was given', async () => {
    const value = { name: 'Atlas', version: '0.1.0', build: '61e907b' };
    await expect(staticAppInfo(value).read()).resolves.toEqual(value);
  });
});
