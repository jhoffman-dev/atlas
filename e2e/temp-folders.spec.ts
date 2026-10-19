import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page } from './fixtures.ts';
import { otherMac } from './git-host.ts';
import { createVault, installHost } from './host.ts';

/*
 * Issue #397: the host helpers never removed the folders they made, and a night
 * of runs left 100,000 of them in the temp folder. A test hands its folders to
 * the next, which checks they are gone once the first has finished, passed or not.
 */
test.describe.serial('the temp folders the host makes', () => {
  let made: string[] = [];

  async function makeEveryKind(page: Page): Promise<string[]> {
    const vault = await createVault();
    const host = await installHost(page, vault);
    const bare = await host.git.bareRepository('vault');
    const mac = await otherMac(host.git, bare, 'Laptop');
    return [vault.root, host.git.env['HOME'] ?? '', dirname(bare), dirname(mac.root)];
  }

  test('are made for a test', async ({ page }) => {
    made = await makeEveryKind(page);
    for (const folder of made) expect(existsSync(folder), folder).toBe(true);
  });

  test('are removed once it passes', () => {
    for (const folder of made) expect(existsSync(folder), folder).toBe(false);
  });

  test('are made for a test that fails', async ({ page }) => {
    test.fail();
    made = await makeEveryKind(page);
    throw new Error('the test fails after making its folders');
  });

  test('are removed once it fails', () => {
    for (const folder of made) expect(existsSync(folder), folder).toBe(false);
  });
});
