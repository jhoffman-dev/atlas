import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { spellingWarnings } from './spelling-warnings.ts';
import type { TermNote } from './term.ts';
import { vocabulary } from './vocabulary.ts';

const term = (canonical: string, variants: readonly string[]): TermNote => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: null,
});

const warningsFor = (terms: TermNote[], people: string[] = []) =>
  spellingWarnings({
    terms,
    vocabulary: vocabulary({
      terms,
      people: people.map((name) => ({
        path: createVaultPath(`People/${name}.md`),
        name,
        aliases: [],
      })),
      companies: [],
    }),
  });

describe('spellingWarnings', () => {
  it('warns when a misheard spelling is a word of another note’s right spelling', () => {
    const terms = [term('Quill Desk', ['Quill', 'quill desks'])];

    expect(warningsFor(terms, ['Mara Quill'])).toEqual([
      { kind: 'inside-name', path: 'Terms/Quill Desk.md', variant: 'Quill', name: 'Mara Quill' },
    ]);
  });

  it('warns for words in a row, and not for the same letters inside a longer word', () => {
    const terms = [term('Q', ['Mara', 'Mar', 'Quill Desk'])];

    expect(warningsFor(terms, ['Mara Quill Desk Lamp']).map((warning) => warning.variant)).toEqual([
      'Mara',
      'Quill Desk',
    ]);
  });

  it('does not warn about a name that is the term’s own, or one in another case', () => {
    expect(warningsFor([term('Larkspur Pay', ['Larkspur'])])).toEqual([]);
    expect(warningsFor([term('Q', ['quill'])], ['Mara Quill'])).toEqual([]);
  });

  it('warns that a spelling with no letter or digit is not used', () => {
    expect(warningsFor([term('Nolan', ['~', ' -- ', 'ok'])])).toEqual([
      { kind: 'unusable', path: 'Terms/Nolan.md', variant: '~' },
      { kind: 'unusable', path: 'Terms/Nolan.md', variant: '--' },
    ]);
  });
});
