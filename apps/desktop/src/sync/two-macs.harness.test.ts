import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { isolatedWorld } from './two-macs.harness.ts';

/*
 * Issue #397: the harness never removed its world, and a night of runs left
 * 20,000 `atlas-two-macs-*` folders in the temp folder.
 */
describe('the two-Macs harness', () => {
  it('removes its world once the test has finished', async () => {
    let base = '';
    // Registered first, so it runs after the harness's own clean-up.
    onTestFinished(() => expect(existsSync(base)).toBe(false));
    ({ base } = await isolatedWorld());
    expect(existsSync(base)).toBe(true);
  });

  let failedBase = '';
  it.fails('removes its world when the test fails too', async () => {
    ({ base: failedBase } = await isolatedWorld());
    throw new Error('the test fails after making its world');
  });
  afterAll(() => expect(existsSync(failedBase)).toBe(false));
});
