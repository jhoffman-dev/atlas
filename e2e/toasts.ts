import type { Locator, Page } from './fixtures.ts';

/**
 * The window's toast saying `words` (#320): drawn over the content, outside
 * every page, so it is found on the window rather than in the page whose
 * change it tells of. Its words are its live region; its Undo is in it.
 */
export function toastSaying(page: Page, words: string): Locator {
  return page.locator('.toast-stack .toast').filter({ hasText: words });
}
