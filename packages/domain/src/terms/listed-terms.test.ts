import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { listedTerms } from './listed-terms.ts';

const at = createVaultPath;

describe('what the Terms page lists (#400)', () => {
  it('is every term, and every person and company with misheard spellings, by right spelling', () => {
    const listed = listedTerms({
      terms: [
        { path: at('Terms/Quill Desk.md'), canonical: 'Quill Desk', variants: [], kind: null },
      ],
      people: [
        {
          path: at('People/Mara Quill.md'),
          name: 'Mara Quill',
          aliases: ['Mara'],
          variants: ['Mara Quil'],
        },
        { path: at('People/Tobias Fenn.md'), name: 'Tobias Fenn', aliases: ['Toby'], variants: [] },
      ],
      companies: [
        {
          path: at('Companies/Larkspur Payroll.md'),
          name: 'Larkspur Payroll',
          aliases: [],
          variants: ['Larkspar Payroll'],
        },
      ],
    });
    expect(listed).toEqual([
      {
        path: 'Companies/Larkspur Payroll.md',
        canonical: 'Larkspur Payroll',
        variants: ['Larkspar Payroll'],
        kind: null,
        source: 'company',
      },
      {
        path: 'People/Mara Quill.md',
        canonical: 'Mara Quill',
        variants: ['Mara Quil'],
        kind: null,
        source: 'person',
      },
      {
        path: 'Terms/Quill Desk.md',
        canonical: 'Quill Desk',
        variants: [],
        kind: null,
        source: 'term',
      },
    ]);
  });
});
