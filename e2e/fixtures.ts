import { test as base } from '@playwright/test';
import { removeTempFolders } from './temp-folders.ts';

export { expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Playwright's `test`, which removes the temp folders the host helpers made once
 * each test has finished, whether it passed or failed. Specs import it from here.
 */
export const test = base.extend<{ removesTempFolders: void }>({
  removesTempFolders: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; it has none.
    async ({}, use) => {
      await use();
      await removeTempFolders();
    },
    { auto: true },
  ],
});
