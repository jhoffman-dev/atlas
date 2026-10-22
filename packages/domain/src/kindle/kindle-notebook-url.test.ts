import { describe, expect, it } from 'vitest';
import {
  KINDLE_NOTEBOOK_URL,
  kindleAnnotationsUrl,
  kindleLibraryUrl,
} from './kindle-notebook-url.ts';

describe('the notebook’s addresses', () => {
  it('reads the library from the notebook itself', () => {
    expect(kindleLibraryUrl()).toBe('https://read.amazon.com/notebook');
  });

  it('asks for a book’s first page with an empty token and limit state', () => {
    expect(kindleAnnotationsUrl('B0EXAMPLE1', null)).toBe(
      `${KINDLE_NOTEBOOK_URL}?asin=B0EXAMPLE1&contentLimitState=&token=`,
    );
  });

  it('asks for the next page with the cursor the last page gave, encoded so it cannot add a parameter', () => {
    const url = new URL(
      kindleAnnotationsUrl('B0EXAMPLE1', { token: 'a&asin=X#y', contentLimitState: 'e/+=' }),
    );
    expect(url.origin + url.pathname).toBe(KINDLE_NOTEBOOK_URL);
    expect([...url.searchParams]).toEqual([
      ['asin', 'B0EXAMPLE1'],
      ['contentLimitState', 'e/+='],
      ['token', 'a&asin=X#y'],
    ]);
    expect(url.hash).toBe('');
  });
});
