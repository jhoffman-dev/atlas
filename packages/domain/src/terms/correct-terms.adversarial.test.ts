/**
 * Adversarial tests for correcting misheard spellings (P28-06, issue #12).
 * Committed red where they find a bug. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { correctTerms } from './correct-terms.ts';
import { vocabulary, type NamedEntity } from './vocabulary.ts';
import type { TermNote } from './term.ts';

const term = (canonical: string, variants: readonly string[]): TermNote => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: null,
});

const person = (name: string, aliases: readonly string[]): NamedEntity => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  aliases,
});

/** A surname alias (`Quill`) and a nickname (`Toby`): the common shapes of a person's aliases. */
const VOCABULARY = vocabulary({
  terms: [term('Larkspur Pay', ['Lark Spur Pay']), term('İzmir Hub', ['izmir hab'])],
  people: [person('Mara Quill', ['Mara Quil', 'Quill']), person('Tobias Fenn', ['Toby'])],
  companies: [],
});

const corrected = (text: string) => correctTerms(text, VOCABULARY).text;

describe('correctTerms, a right spelling the matcher does not see as one', () => {
  it('never doubles a name wrapped onto the next line at a soft line break', () => {
    expect(corrected('Then Mara\nQuill said it ships.')).toBe('Then Mara\nQuill said it ships.');
  });

  it('never doubles a name whose first word is emphasised', () => {
    expect(corrected('**Mara** Quill owns it.')).toBe('**Mara** Quill owns it.');
  });
});

describe('correctTerms, text that is not words', () => {
  it('never corrects inside an email address', () => {
    expect(corrected('Mail toby@fennlabs.example now.')).toBe('Mail toby@fennlabs.example now.');
  });

  it('never corrects inside a bare domain', () => {
    expect(corrected('See www.quill.example for it.')).toBe('See www.quill.example for it.');
  });

  it('never corrects inside a file path', () => {
    expect(corrected('It lives in src/quill/index.ts today.')).toBe(
      'It lives in src/quill/index.ts today.',
    );
  });

  it('leaves a markdown link whole when its target holds parentheses', () => {
    expect(corrected('[Toby](https://wiki.example/Toby_(team)) wrote it.')).toBe(
      '[Toby](https://wiki.example/Toby_(team)) wrote it.',
    );
  });

  it('never rewrites a transcript time with a variant that has no word in it', () => {
    const tilde = vocabulary({ terms: [term('Nolan', ['~'])], people: [], companies: [] });

    expect(correctTerms('**Mara Quill** [~00:00:05] Morning.', tilde).text).toBe(
      '**Mara Quill** [~00:00:05] Morning.',
    );
  });
});

describe('correctTerms, case', () => {
  it('corrects a shouted spelling with a dotted capital I as it does one without', () => {
    // `IZMIR HAB` is corrected; the Turkish capital İ has no simple case fold to i.
    expect(corrected('İZMIR HAB is late.')).toBe('İZMIR HUB is late.');
  });
});
