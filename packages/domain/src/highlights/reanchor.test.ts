import { describe, expect, it } from 'vitest';
import { findQuote, findQuoteNear, QUOTE_CONTEXT, quoteSelectorAt } from './reanchor.ts';

const PAGE =
  'The good fighter is able to secure himself against defeat. ' +
  'To secure ourselves against defeat lies in our own hands.';

const exactAt = (text: string, match: { start: number; end: number } | null) =>
  match === null ? null : text.slice(match.start, match.end);

describe('making a selector', () => {
  it('keeps the words and up to the context either side', () => {
    const start = PAGE.indexOf('secure ourselves');
    const selector = quoteSelectorAt({ text: PAGE, start, end: start + 16 });
    expect(selector.exact).toBe('secure ourselves');
    expect(selector.prefix).toBe(PAGE.slice(start - QUOTE_CONTEXT, start));
    expect(selector.suffix).toBe(PAGE.slice(start + 16, start + 16 + QUOTE_CONTEXT));
  });

  it('keeps less context at the edges of the text', () => {
    expect(quoteSelectorAt({ text: PAGE, start: 0, end: 3 })).toMatchObject({
      exact: 'The',
      prefix: '',
    });
    expect(quoteSelectorAt({ text: PAGE, start: PAGE.length - 6, end: PAGE.length }).suffix).toBe(
      '',
    );
  });
});

describe('finding a quote by its words', () => {
  it('finds the only copy', () => {
    const match = findQuote(PAGE, { exact: 'lies in our own hands', prefix: '', suffix: '' });
    expect(exactAt(PAGE, match)).toBe('lies in our own hands');
  });

  it('tells two copies apart by the text either side', () => {
    const second = PAGE.lastIndexOf('against defeat');
    const selector = quoteSelectorAt({ text: PAGE, start: second, end: second + 14 });
    expect(findQuote(PAGE, selector)?.start).toBe(second);
    const first = PAGE.indexOf('against defeat');
    expect(
      findQuote(PAGE, quoteSelectorAt({ text: PAGE, start: first, end: first + 14 }))?.start,
    ).toBe(first);
  });

  it('finds nothing among copies with nothing to tell them apart (ADR-0043 section 9)', () => {
    expect(findQuote('ab ab ab', { exact: 'ab', prefix: '', suffix: '' })).toBeNull();
  });

  it('tells copies apart by their whitespace when the loose comparison cannot', () => {
    const text = 'x  deception\ny deception';
    const selector = quoteSelectorAt({
      text,
      start: text.lastIndexOf('deception'),
      end: text.length,
    });
    expect(findQuote(text, selector)?.start).toBe(text.lastIndexOf('deception'));
  });

  it('finds the words across line breaks and runs of spaces, in the text as given', () => {
    const reflowed = 'The good fighter is able to\n   secure himself\r\nagainst  defeat.';
    const match = findQuote(reflowed, {
      exact: 'to secure himself against defeat',
      prefix: 'is able ',
      suffix: '.',
    });
    expect(exactAt(reflowed, match)).toBe('to\n   secure himself\r\nagainst  defeat');
  });

  it('finds words that start or end in whitespace by the words themselves', () => {
    expect(exactAt(PAGE, findQuote(PAGE, { exact: '  our own\n', prefix: '', suffix: '' }))).toBe(
      'our own',
    );
  });

  it('does not find changed words, nor nothing', () => {
    expect(findQuote(PAGE, { exact: 'lies in their hands', prefix: '', suffix: '' })).toBeNull();
    expect(findQuote(PAGE, { exact: ' \n', prefix: '', suffix: '' })).toBeNull();
    expect(findQuote('', { exact: 'x', prefix: '', suffix: '' })).toBeNull();
  });
});

describe("finding a quote among a document's sections", () => {
  const pages = ['Alpha beta.', 'Gamma delta.', 'Beta again.', 'Epsilon.', 'Gamma delta.'];
  const selector = (exact: string) => ({ exact, prefix: '', suffix: '' });

  it('looks on the page the anchor named first', () => {
    expect(findQuoteNear({ sections: pages, selector: selector('Gamma'), near: 4 })).toEqual({
      section: 4,
      start: 0,
      end: 5,
    });
  });

  it('then outward, nearer first and earlier of two equally near', () => {
    expect(findQuoteNear({ sections: pages, selector: selector('Gamma'), near: 2 })?.section).toBe(
      1,
    );
    expect(
      findQuoteNear({ sections: pages, selector: selector('Epsilon'), near: 0 })?.section,
    ).toBe(3);
    expect(findQuoteNear({ sections: pages, selector: selector('Alpha'), near: 3 })?.section).toBe(
      0,
    );
  });

  it('starts from the nearest section when the anchor names one past the end', () => {
    expect(findQuoteNear({ sections: pages, selector: selector('Gamma'), near: 99 })?.section).toBe(
      4,
    );
    expect(findQuoteNear({ sections: pages, selector: selector('Alpha'), near: -5 })?.section).toBe(
      0,
    );
  });

  it('is null when no section has the words, or there are none', () => {
    expect(findQuoteNear({ sections: pages, selector: selector('Omega'), near: 1 })).toBeNull();
    expect(findQuoteNear({ sections: [], selector: selector('Alpha'), near: 0 })).toBeNull();
  });
});
