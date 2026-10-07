import { describe, expect, it } from 'vitest';
import { plainText } from './index.ts';

describe('plainText', () => {
  it('takes the backticks off code and keeps the code', () => {
    expect(plainText('A14-06 found a bar: `addDays` returned its input')).toBe(
      'A14-06 found a bar: addDays returned its input',
    );
    expect(plainText('Run ``pnpm gate`` first')).toBe('Run pnpm gate first');
  });

  it('keeps the words of emphasis, strong and struck text', () => {
    expect(plainText('This is **very** *much* __so__ and _here_ ~~not~~')).toBe(
      'This is very much so and here not',
    );
  });

  it('drops a strong or struck mark whose other half was cut off', () => {
    expect(plainText('~~In-app views, dashboards and aggregates include…')).toBe(
      'In-app views, dashboards and aggregates include…',
    );
    expect(plainText('**Bold and never closed')).toBe('Bold and never closed');
  });

  it('leaves underscores inside a name alone', () => {
    expect(plainText('Set blocked_by and due_date')).toBe('Set blocked_by and due_date');
  });

  it('leaves a lone asterisk alone', () => {
    expect(plainText('2 * 3 is six')).toBe('2 * 3 is six');
  });

  it('drops list markers, task boxes, quotes and heading marks', () => {
    expect(plainText('- In-app views include templates')).toBe('In-app views include templates');
    expect(plainText('1. First')).toBe('First');
    expect(plainText('* [ ] Buy milk')).toBe('Buy milk');
    expect(plainText('> James: "go ahead"')).toBe('James: "go ahead"');
    expect(plainText('## Heading')).toBe('Heading');
  });

  it('reads a link as its text, an image as its description', () => {
    expect(plainText('See [the plan](https://example.com/plan) now')).toBe('See the plan now');
    expect(plainText('![a chart](chart.png) above')).toBe('a chart above');
  });

  it('reads a wiki link as its alias, or its target', () => {
    expect(plainText('Blocked by [[P16-03]]')).toBe('Blocked by P16-03');
    expect(plainText('See [[P16-03|page anatomy]]')).toBe('See page anatomy');
  });

  it('keeps a hyphen that is not a list marker, and collapses spacing', () => {
    expect(plainText('  Phase 16 -   the  look ')).toBe('Phase 16 - the look');
  });

  it('hides a comment, as every markdown reader does: a bookmark reads as its link', () => {
    expect(plainText('[[Trip plan]] <!-- atlas:bookmark -->')).toBe('Trip plan');
    expect(plainText('Before <!-- a\nlong note --> after')).toBe('Before after');
  });

  it('is empty for nothing', () => {
    expect(plainText('')).toBe('');
  });
});
