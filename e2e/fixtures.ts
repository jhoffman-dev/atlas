import { test as base } from '@playwright/test';
import { removeTempFolders, tempFoldersMade } from './temp-folders.ts';

export { expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Playwright's `test`, which removes the temp folders the host helpers made: a
 * test's own once it has finished, passed or failed, and those a `beforeAll`
 * made for the tests after it once the worker ends. Specs import it from here.
 */
export const test = base.extend<
  { removesTestTempFolders: void },
  { removesWorkerTempFolders: void }
>({
  removesTestTempFolders: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; it has none.
    async ({}, use) => {
      const before = tempFoldersMade();
      await use();
      await removeTempFolders(before);
    },
    { auto: true },
  ],
  removesWorkerTempFolders: [
    // eslint-disable-next-line no-empty-pattern -- as above.
    async ({}, use) => {
      await use();
      await removeTempFolders();
    },
    { scope: 'worker', auto: true },
  ],
});
