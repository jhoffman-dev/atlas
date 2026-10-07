import { describe, expect, it } from 'vitest';
import { summaryOf } from './summary.ts';

describe('summaryOf', () => {
  it('takes the first line that says something', () => {
    expect(summaryOf('\n\nThe first real line.\nAnd a second.\n')).toBe('The first real line.');
  });

  it('skips a heading, which a card already shows as the title', () => {
    expect(summaryOf('# The title\n\nWhat it is about.\n')).toBe('What it is about.');
  });

  it('skips several headings', () => {
    expect(summaryOf('# One\n## Two\n\nBody.\n')).toBe('Body.');
  });

  it('trims the line', () => {
    expect(summaryOf('   padded   \n')).toBe('padded');
  });

  it('shortens a long line rather than filling the card', () => {
    const summary = summaryOf('x'.repeat(400));
    expect(summary.length).toBe(160);
    expect(summary.endsWith('…')).toBe(true);
  });

  it.each(['', '   ', '\n\n', '# Only a heading\n'])('returns nothing for %j', (text) => {
    expect(summaryOf(text)).toBe('');
  });

  it('keeps markdown it finds, rather than guessing at it', () => {
    expect(summaryOf('A line with **bold** in it.\n')).toBe('A line with **bold** in it.');
  });

  it('leaves off the block id that ends the opening line (P26-01)', () => {
    expect(summaryOf('# Title\n\nThe plan, roughly. ^f3k9x2\n')).toBe('The plan, roughly.');
    expect(summaryOf('x^2 is kept ^\n')).toBe('x^2 is kept ^');
  });
});
